/**
 * Testes do núcleo de planejamento.
 *
 * Runner nativo do Node (`node --test`), sem dependência externa —
 * coerente com a decisão do projeto de não ter etapa de build.
 *
 * O gerador aleatório é injetado em todo teste de pontuação. Com
 * `rng = () => 0.5` o jitter vira exatamente 0 (0.5 * 8 - 4), o que deixa
 * as notas determinísticas e permite afirmar valor exato em vez de faixa.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const FP = require('../www/js/planner.js');

const rngZero = () => 0;     // jitter = -4 · sorteio pega o primeiro
const rngMeio = () => 0.5;   // jitter =  0 · nota exata

/** Receita mínima; sobrescreva só o que o teste precisa. */
function receita(over = {}) {
  return {
    id: 'r1', nome: 'Arroz com Frango', cat: 'proteina', proteina: 'frango',
    porcoes: 4, custo: 10, ings: [{ n: 'arroz', q: 320, u: 'g' }],
    ...over
  };
}

/** Contexto de pontuação com tudo neutro; sobrescreva o que interessa. */
function ctx(over = {}) {
  return {
    config: { max_proteina: 3, no_massa_twice: true },
    estoque: [], protCount: {}, lastTwo: [], promoNames: [],
    blocked: [], estilo: 'tudo', lastCat: '', rng: rngMeio,
    ...over
  };
}

// ══════════════════════════════════════════════════ estoque

describe('getStock', () => {
  test('devolve 0 quando o item não está em estoque', () => {
    assert.equal(FP.getStock([], 'frango'), 0);
  });

  test('converte cada unidade para gramas', () => {
    const g = (unit, qty) => FP.getStock([{ nome: 'arroz', qty, unit }], 'arroz');
    assert.equal(g('g', 500), 500);
    assert.equal(g('kg', 2), 2000);
    assert.equal(g('L', 1.5), 1500);
    assert.equal(g('un', 6), 600);
    assert.equal(g('dz', 1), 1200);
  });

  test('encontra o item por nome parcial', () => {
    const estoque = [{ nome: 'Arroz', qty: 1, unit: 'kg' }];
    assert.equal(FP.getStock(estoque, 'arroz'), 1000);
  });
});

// ══════════════════════════════════════════════════ preço

describe('getPrice', () => {
  test('lê o preço da tabela', () => {
    assert.equal(FP.getPrice({ arroz: 6 }, [], 'arroz'), 6);
  });

  test('promoção tem precedência sobre a tabela', () => {
    assert.equal(FP.getPrice({ frango: 14 }, [{ nome: 'frango', preco: 9 }], 'frango'), 9);
  });

  test('promoção com preço zero é ignorada', () => {
    // Guarda do `prom.preco > 0`: promoção cadastrada sem preço não deve
    // zerar o custo do item.
    assert.equal(FP.getPrice({ frango: 14 }, [{ nome: 'frango', preco: 0 }], 'frango'), 14);
  });

  test('item desconhecido cai no preço padrão', () => {
    assert.equal(FP.getPrice({}, [], 'jaca'), FP.PRECO_PADRAO);
  });
});

describe('ingGrams', () => {
  test('lê a tabela de gramas por porção', () => {
    assert.equal(FP.ingGrams('frango'), 140);
  });

  test('ingrediente desconhecido cai no padrão', () => {
    assert.equal(FP.ingGrams('jaca'), FP.GRAMAS_PADRAO);
  });
});

// ══════════════════════════════════════════════════ restrições rígidas

describe('scoreReceita — restrições rígidas', () => {
  test('ingrediente bloqueado elimina a receita', () => {
    const s = FP.scoreReceita(receita(), ctx({ blocked: ['arroz'] }));
    assert.equal(s, FP.SCORE_BLOQUEADO);
  });

  test('o bloqueio também vale para o nome da receita', () => {
    const s = FP.scoreReceita(receita({ ings: [] }), ctx({ blocked: ['frango'] }));
    assert.equal(s, FP.SCORE_BLOQUEADO);
  });

  test('estilo vegetariano elimina proteína animal', () => {
    const s = FP.scoreReceita(receita({ proteina: 'frango' }), ctx({ estilo: 'vegetariano' }));
    assert.equal(s, FP.SCORE_BLOQUEADO);
  });

  test('estilo vegetariano aceita vegetal e ovo', () => {
    for (const p of ['vegetal', 'ovo']) {
      const s = FP.scoreReceita(receita({ proteina: p }), ctx({ estilo: 'vegetariano' }));
      assert.notEqual(s, FP.SCORE_BLOQUEADO, `proteína ${p} deveria passar`);
    }
  });

  test('massa em dois dias seguidos é eliminada', () => {
    const s = FP.scoreReceita(receita({ cat: 'massa' }), ctx({ lastCat: 'massa' }));
    assert.equal(s, FP.SCORE_BLOQUEADO);
  });

  test('com a regra desligada, massa seguida é permitida', () => {
    const s = FP.scoreReceita(
      receita({ cat: 'massa' }),
      ctx({ lastCat: 'massa', config: { max_proteina: 3, no_massa_twice: false } })
    );
    assert.notEqual(s, FP.SCORE_BLOQUEADO);
  });

  test('excedido o limite da proteína, a nota despenca', () => {
    const s = FP.scoreReceita(receita(), ctx({ protCount: { frango: 3 } }));
    assert.equal(s, FP.SCORE_EXCESSO_PROTEINA);
  });

  test('o limite de proteína respeita a configuração', () => {
    const c = { max_proteina: 2, no_massa_twice: true };
    assert.equal(
      FP.scoreReceita(receita(), ctx({ config: c, protCount: { frango: 2 } })),
      FP.SCORE_EXCESSO_PROTEINA
    );
    assert.notEqual(
      FP.scoreReceita(receita(), ctx({ config: c, protCount: { frango: 1 } })),
      FP.SCORE_EXCESSO_PROTEINA
    );
  });
});

// ══════════════════════════════════════════════════ preferências suaves

describe('scoreReceita — preferências suaves', () => {
  test('nota base sem nenhum fator ativo', () => {
    assert.equal(FP.scoreReceita(receita(), ctx()), FP.SCORE_BASE);
  });

  test('promoção soma o peso de promoção', () => {
    const s = FP.scoreReceita(receita(), ctx({ promoNames: ['arroz'] }));
    assert.equal(s, FP.SCORE_BASE + FP.PESOS.promocao);
  });

  test('estoque soma por ingrediente disponível', () => {
    const r = receita({ ings: [{ n: 'arroz', q: 100, u: 'g' }, { n: 'feijão', q: 100, u: 'g' }] });
    const estoque = [{ nome: 'arroz', qty: 1, unit: 'kg' }, { nome: 'feijão', qty: 1, unit: 'kg' }];
    const s = FP.scoreReceita(r, ctx({ estoque }));
    assert.equal(s, FP.SCORE_BASE + 2 * FP.PESOS.estoquePorItem);
  });

  test('o bônus de estoque tem teto', () => {
    const nomes = ['arroz', 'feijão', 'frango', 'tomate', 'cebola', 'alho', 'batata'];
    const r = receita({ ings: nomes.map(n => ({ n, q: 100, u: 'g' })) });
    const estoque = nomes.map(nome => ({ nome, qty: 1, unit: 'kg' }));
    const s = FP.scoreReceita(r, ctx({ estoque }));
    // 7 ingredientes × 5 = 35, mas o teto é 25
    assert.equal(s, FP.SCORE_BASE + FP.PESOS.estoqueTeto);
  });

  test('receita usada nos últimos dois dias é penalizada', () => {
    const s = FP.scoreReceita(receita(), ctx({ lastTwo: ['r1'] }));
    assert.equal(s, FP.SCORE_BASE + FP.PESOS.recencia);
  });

  test('proteína repetida duas vezes é penalizada', () => {
    const s = FP.scoreReceita(receita(), ctx({ protCount: { frango: 2 } }));
    assert.equal(s, FP.SCORE_BASE + FP.PESOS.repeticaoProteina);
  });

  test('estilo econômico premia por faixa de custo', () => {
    const nota = custo => FP.scoreReceita(receita({ custo }), ctx({ estilo: 'economico' }));
    assert.equal(nota(8),  FP.SCORE_BASE + 30);
    assert.equal(nota(12), FP.SCORE_BASE + 10);
    assert.equal(nota(20), FP.SCORE_BASE);
  });

  test('o jitter fica dentro da faixa declarada', () => {
    const nota = rng => FP.scoreReceita(receita(), ctx({ rng }));
    const meia = FP.PESOS.jitter / 2;
    assert.equal(nota(() => 0), FP.SCORE_BASE - meia);
    assert.equal(nota(() => 1), FP.SCORE_BASE + meia);
  });
});

// ══════════════════════════════════════════════════ seleção

describe('selectRecipe', () => {
  const baratissima = receita({ id: 'barata', custo: 5 });
  const media       = receita({ id: 'media', custo: 10 });
  const cara        = receita({ id: 'cara', custo: 30 });

  test('com sorteio no início, escolhe a de maior nota', () => {
    const escolhida = FP.selectRecipe(
      [cara, media, baratissima],
      ctx({ estilo: 'economico', rng: rngZero })
    );
    assert.equal(escolhida.id, 'barata');
  });

  test('nunca escolhe receita eliminada por restrição rígida', () => {
    const bloqueada = receita({ id: 'bloqueada', ings: [{ n: 'camarão', q: 100, u: 'g' }] });
    const livre     = receita({ id: 'livre', ings: [{ n: 'arroz', q: 100, u: 'g' }] });
    for (let i = 0; i < 50; i++) {
      const escolhida = FP.selectRecipe([bloqueada, livre], ctx({ blocked: ['camarão'], rng: Math.random }));
      assert.equal(escolhida.id, 'livre');
    }
  });

  test('sorteia apenas entre as três melhores', () => {
    // Cinco receitas de custo crescente com estilo econômico: as três mais
    // baratas são as candidatas, a quarta e a quinta nunca podem sair.
    const lista = [5, 7, 9, 25, 30].map((custo, i) => receita({ id: 'r' + i, custo }));
    const vistas = new Set();
    for (let i = 0; i < 300; i++) {
      vistas.add(FP.selectRecipe(lista, ctx({ estilo: 'economico', rng: Math.random })).id);
    }
    assert.equal(vistas.size, 3);
    assert.ok(!vistas.has('r3') && !vistas.has('r4'), 'as duas piores não devem sair');
  });

  test('com todas eliminadas, ainda devolve uma receita', () => {
    const lista = [receita({ id: 'a' }), receita({ id: 'b' })];
    const escolhida = FP.selectRecipe(lista, ctx({ blocked: ['arroz'], rng: rngZero }));
    assert.ok(escolhida, 'não deve devolver undefined');
    assert.ok(lista.includes(escolhida));
  });
});

// ══════════════════════════════════════════════════ necessidade

describe('calcNeeds', () => {
  const config = { frutas: false, dias: 7, moradores: 2 };

  test('escala a quantidade por lotes e porções', () => {
    const r = receita({ porcoes: 4, ings: [{ n: 'arroz', q: 100, u: 'g' }] });
    // fator = lotes 2 × (8 porções / 4 da receita) = 4
    const needs = FP.calcNeeds([{ receita: r, lotes: 2, porcoes: 8 }], config);
    assert.equal(needs.arroz, 400);
  });

  test('soma o mesmo ingrediente entre dias diferentes', () => {
    const r = receita({ porcoes: 4, ings: [{ n: 'arroz', q: 100, u: 'g' }] });
    const dia = { receita: r, lotes: 1, porcoes: 4 };
    const needs = FP.calcNeeds([dia, dia], config);
    assert.equal(needs.arroz, 200);
  });

  test('converte a unidade do ingrediente', () => {
    const r = receita({ porcoes: 4, ings: [{ n: 'leite', q: 1, u: 'L' }] });
    const needs = FP.calcNeeds([{ receita: r, lotes: 1, porcoes: 4 }], config);
    assert.equal(needs.leite, 1000);
  });

  test('o módulo de frutas soma quando ligado', () => {
    const r = receita({ porcoes: 4, ings: [] });
    const dia = { receita: r, lotes: 1, porcoes: 4 };
    const semFrutas = FP.calcNeeds([dia], { frutas: false, dias: 7, moradores: 2 });
    const comFrutas = FP.calcNeeds([dia], { frutas: true, dias: 7, moradores: 2 });
    assert.equal(semFrutas.banana, undefined);
    // 7 dias × 2 moradores × 0.4 × 120 g
    assert.equal(comFrutas.banana, 14 * 0.4 * 120);
  });
});

// ══════════════════════════════════════════════════ lista de compras

describe('calcShoppingList', () => {
  const base = {
    config: { frutas: false, dias: 7, moradores: 2 },
    estoque: [], precos: FP.PRECOS_BASE, promocoes: []
  };
  const umDia = ings => ([{ receita: receita({ porcoes: 4, ings }), lotes: 1, porcoes: 4 }]);
  const achar = (lista, nome) =>
    lista.flatMap(c => c.items).find(i => i.nome === nome);

  test('agrupa os itens por corredor', () => {
    const lista = FP.calcShoppingList({
      ...base,
      plano: umDia([{ n: 'frango', q: 500, u: 'g' }, { n: 'arroz', q: 300, u: 'g' }])
    });
    const cats = lista.map(c => c.cat);
    assert.ok(cats.some(c => c.includes('Açougue')));
    assert.ok(cats.some(c => c.includes('Mercearia')));
  });

  test('subtrai o que já existe em estoque', () => {
    const plano = umDia([{ n: 'arroz', q: 1000, u: 'g' }]);
    const semEstoque = achar(FP.calcShoppingList({ ...base, plano }), 'arroz');
    const comEstoque = achar(FP.calcShoppingList({
      ...base, plano, estoque: [{ nome: 'arroz', qty: 600, unit: 'g' }]
    }), 'arroz');
    assert.equal(semEstoque.buyG, 1000);
    assert.equal(comEstoque.buyG, 400);
  });

  test('estoque suficiente remove o item da lista', () => {
    const lista = FP.calcShoppingList({
      ...base,
      plano: umDia([{ n: 'arroz', q: 500, u: 'g' }]),
      estoque: [{ nome: 'arroz', qty: 2, unit: 'kg' }]
    });
    assert.equal(achar(lista, 'arroz'), undefined);
  });

  test('quantidade abaixo do mínimo não entra na lista', () => {
    const lista = FP.calcShoppingList({ ...base, plano: umDia([{ n: 'arroz', q: 5, u: 'g' }]) });
    assert.equal(achar(lista, 'arroz'), undefined);
  });

  test('o custo é o peso em kg vezes o preço', () => {
    const item = achar(
      FP.calcShoppingList({ ...base, plano: umDia([{ n: 'arroz', q: 2000, u: 'g' }]) }),
      'arroz'
    );
    assert.equal(item.buyKg, 2);
    assert.equal(item.custo, 2 * FP.PRECOS_BASE['arroz']);
  });

  test('promoção entra no custo e marca o item', () => {
    const plano = umDia([{ n: 'frango', q: 1000, u: 'g' }]);
    const item = achar(FP.calcShoppingList({
      ...base, plano, promocoes: [{ nome: 'frango', preco: 9 }]
    }), 'frango');
    assert.equal(item.emPromocao, true);
    assert.equal(item.custo, 9);
  });

  test('ingrediente sem corredor conhecido cai em Outros', () => {
    const lista = FP.calcShoppingList({ ...base, plano: umDia([{ n: 'jaca', q: 500, u: 'g' }]) });
    const outros = lista.find(c => c.cat.includes('Outros'));
    assert.ok(outros, 'deveria existir a categoria Outros');
    assert.equal(outros.items[0].nome, 'jaca');
  });

  test('plano vazio devolve lista vazia', () => {
    assert.deepEqual(FP.calcShoppingList({ ...base, plano: [] }), []);
  });
});

// ══════════════════════════════════════════════════ limitações conhecidas

describe('LIMITAÇÕES CONHECIDAS — casamento por substring', () => {
  /**
   * Estes testes afirmam o comportamento ERRADO de hoje, de propósito.
   *
   * O casamento de nomes compara por substring nos dois sentidos, então um
   * item cujo nome contém o nome de outro resolve para o item errado. Como
   * `Object.keys` preserva a ordem de inserção, quem aparece primeiro na
   * tabela vence.
   *
   * Quando a correção entrar, estes testes falham — e a falha é o sinal de
   * que a correção funcionou. Aí o valor esperado é trocado pelo correto.
   */

  test('preço de "batata doce" resolve para o de "batata"', () => {
    // 'batata' vem antes na tabela e é substring de 'batata doce'
    assert.equal(FP.getPrice(FP.PRECOS_BASE, [], 'batata doce'), 5); // correto: 6
  });

  test('preço de "couve" resolve para o de "couve-flor"', () => {
    // 'couve-flor' vem antes na tabela e contém 'couve'
    assert.equal(FP.getPrice(FP.PRECOS_BASE, [], 'couve'), 7); // correto: 5
  });

  test('estoque de "alho-poró" é contado como estoque de "alho"', () => {
    const estoque = [{ nome: 'alho-poró', qty: 200, unit: 'g' }];
    assert.equal(FP.getStock(estoque, 'alho'), 200); // correto: 0
  });

  test('estoque de "couve-flor" é contado como estoque de "couve"', () => {
    const estoque = [{ nome: 'couve-flor', qty: 500, unit: 'g' }];
    assert.equal(FP.getStock(estoque, 'couve'), 500); // correto: 0
  });
});

// ══════════════════════════════════════════════════ exibição de quantidade

describe('formatQty', () => {
  test('ovos são exibidos em unidades', () => {
    assert.equal(FP.formatQty('ovos', 550), '6 un');
  });

  test('atum é exibido em latas, com plural', () => {
    assert.equal(FP.formatQty('atum', 100), '1 lata');
    assert.equal(FP.formatQty('atum', 250), '3 latas');
  });

  test('alface é exibida em unidades', () => {
    assert.equal(FP.formatQty('alface', 300), '2 un');
  });

  test('a partir de 1 kg usa kg com uma decimal', () => {
    assert.equal(FP.formatQty('arroz', 1500), '1.5 kg');
  });

  test('abaixo de 1 kg usa gramas arredondadas', () => {
    assert.equal(FP.formatQty('arroz', 750.4), '750 g');
  });
});
