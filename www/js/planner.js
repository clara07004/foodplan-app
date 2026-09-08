/**
 * FoodPlan — núcleo de planejamento
 *
 * Lógica pura de pontuação de receitas e cálculo da lista de compras.
 * Nada aqui toca no DOM nem lê estado global: tudo entra por parâmetro.
 *
 * Isso existe para que as regras de decisão do app possam ser testadas
 * isoladamente. A interface (index.html) consome este módulo pela global
 * `FoodPlan`; os testes o consomem por `require`.
 *
 * O gerador aleatório é injetável (`rng`) porque a pontuação aplica jitter
 * e a seleção sorteia entre as melhores candidatas — sem injetar, nenhuma
 * das duas seria testável de forma determinística.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FoodPlan = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────────────────────────────── tabelas de referência

  const PRECOS_BASE = {
    // Proteínas
    'frango':14,'carne moída':22,'carne bovina':28,'linguiça':18,'peixe':25,'atum':5,
    // Grãos
    'arroz':6,'feijão':9,'macarrão':5,'farinha de mandioca':5,'manteiga':30,
    // Laticínios
    'ovos':0.9,'leite':5,'queijo':42,
    // Raízes e tubérculos
    'batata':5,'batata doce':6,'cenoura':5,
    // Legumes do dia a dia
    'abobrinha':6,'chuchu':4,'quiabo':8,'jiló':7,'pepino':5,
    // Crucíferas
    'brócolis':8,'couve-flor':7,'couve':5,
    // Folhas e saladas
    'alface':4,'rúcula':6,'agrião':5,'espinafre':6,
    // Temperos e base
    'tomate':8,'cebola':4,'alho':28,'azeite':30,'limão':1.2,
    // Frutas
    'banana':4,'maçã':9,'mamão':7,'laranja':6,'uva':18,'pera':13,'melão':5,'melancia':3,
    // Básicos
    'sal':3,'pimenta':20
  };

  const CORREDORES = {
    '🥩 Açougue':['frango','carne moída','carne bovina','linguiça','peixe'],
    '🌾 Mercearia':['arroz','feijão','macarrão','farinha de mandioca','atum'],
    '🥛 Laticínios':['ovos','leite','queijo','manteiga'],
    '🥕 Raízes e Tubérculos':['batata','batata doce','cenoura','chuchu','abobrinha'],
    '🥦 Legumes e Verduras':['brócolis','couve-flor','couve','quiabo','jiló','pepino','tomate','cebola','alho','limão'],
    '🥗 Saladas e Folhas':['alface','rúcula','agrião','espinafre'],
    '🍌 Frutas':['banana','maçã','mamão','laranja','uva','pera','melão','melancia'],
    '🧂 Temperos':['sal','pimenta','azeite'],
    '📦 Outros':[]
  };

  /** Gramas por porção, por ingrediente. */
  const ING_GRAMS = {
    'frango':140,'carne moída':120,'carne bovina':140,'linguiça':80,'peixe':150,'atum':50,
    'arroz':80,'feijão':70,'macarrão':100,'lentilha':75,
    'ovos':55,'leite':120,'queijo':30,'manteiga':15,
    'batata':120,'batata doce':120,'cenoura':80,'abobrinha':100,'chuchu':100,
    'brócolis':90,'couve-flor':100,'couve':50,'quiabo':90,'jiló':80,'pepino':80,
    'alface':40,'rúcula':30,'agrião':30,'espinafre':40,
    'tomate':80,'cebola':50,'alho':8,'azeite':10,'limão':20,
    'banana':100,'maçã':130,'mamão':120,
    'sal':3,'pimenta':2,'tempero':3
  };

  /** Multiplicador para converter a unidade cadastrada em gramas. */
  const UNIT_TO_GRAMS = { kg:1000, L:1000, un:100, dz:1200 };

  const PRECO_PADRAO = 10;   // usado quando o item não está na tabela
  const GRAMAS_PADRAO = 80;  // usado quando o ingrediente não está na tabela
  const MIN_COMPRA_G = 10;   // abaixo disso o item não entra na lista

  // ───────────────────────────────── casamento de nomes

  /**
   * Casamento frouxo entre nomes de ingrediente.
   *
   * LIMITAÇÃO CONHECIDA: compara por substring nos dois sentidos, então
   * nomes próximos casam por engano — "cebola" casa com "cebolinha".
   * O comportamento está preservado de propósito: corrigir isso muda o
   * resultado do app e é uma alteração separada, com os testes já no lugar
   * para provar que a correção não quebra os casamentos legítimos.
   */
  function looseMatch(a, b) {
    return a === b || a.includes(b) || b.includes(a);
  }

  // ───────────────────────────────── estoque e preço

  /** Quantidade em gramas do item disponível em estoque. 0 se não houver. */
  function getStock(estoque, item) {
    const nm = item.toLowerCase();
    const found = (estoque || []).find(e => looseMatch(nm, e.nome.toLowerCase()));
    if (!found) return 0;
    return found.qty * (UNIT_TO_GRAMS[found.unit] || 1);
  }

  /** Preço por kg do item. Promoção vence a tabela; sem nenhum dos dois, PRECO_PADRAO. */
  function getPrice(precos, promocoes, item) {
    const nm = item.toLowerCase();
    const prom = (promocoes || []).find(p => looseMatch(nm, p.nome.toLowerCase()));
    if (prom && prom.preco > 0) return prom.preco;
    const k = Object.keys(precos || {}).find(k => looseMatch(nm, k));
    return k ? precos[k] : PRECO_PADRAO;
  }

  /** Gramas por porção do ingrediente. */
  function ingGrams(name) {
    const k = Object.keys(ING_GRAMS).find(k => looseMatch(name, k));
    return k ? ING_GRAMS[k] : GRAMAS_PADRAO;
  }

  /** Nomes dos ingredientes de uma receita, aceitando string ou {n,q,u}. */
  function ingNames(recipe) {
    return (recipe.ings || []).map(g => (typeof g === 'object' ? g.n : g));
  }

  // ───────────────────────────────── pontuação

  const SCORE_BASE = 50;
  const SCORE_BLOQUEADO = -9999;  // eliminada do conjunto de candidatas
  const SCORE_EXCESSO_PROTEINA = -500;

  const PESOS = {
    promocao: 35,
    estoquePorItem: 5,
    estoqueTeto: 25,
    recencia: -60,
    repeticaoProteina: -25,
    jitter: 8
  };

  const BONUS_ESTILO = {
    economico:   r => (r.custo <= 8 ? 30 : r.custo <= 12 ? 10 : 0),
    proteina:    r => (r.cat === 'proteina' || r.cat === 'fit' ? 20 : 0),
    lowcarb:     r => (r.cat === 'fit' || r.proteina === 'vegetal' || r.proteina === 'ovo' ? 20 : 0),
    equilibrado: () => 15,
    fit:         r => (r.cat === 'fit' ? 25 : 0),
    vegetariano: () => 0
  };

  /**
   * Nota de uma receita para o próximo dia do plano.
   *
   * Restrições rígidas devolvem SCORE_BLOQUEADO e são filtradas antes do
   * sorteio; preferências suaves apenas deslocam a nota.
   *
   * @param {object} recipe
   * @param {object} ctx  {config, estoque, protCount, lastTwo, promoNames,
   *                       blocked, estilo, lastCat, rng}
   */
  function scoreReceita(recipe, ctx) {
    const config = ctx.config || {};
    const blocked = ctx.blocked || [];
    const promoNames = ctx.promoNames || [];
    const protCount = ctx.protCount || {};
    const lastTwo = ctx.lastTwo || [];
    const rng = ctx.rng || Math.random;
    const ings = ingNames(recipe);

    // ── restrições rígidas
    for (const b of blocked) {
      if (ings.some(ing => ing.includes(b)) || recipe.nome.toLowerCase().includes(b)) {
        return SCORE_BLOQUEADO;
      }
    }
    if (ctx.estilo === 'vegetariano' && recipe.proteina !== 'vegetal' && recipe.proteina !== 'ovo') {
      return SCORE_BLOQUEADO;
    }
    if (config.no_massa_twice && recipe.cat === 'massa' && ctx.lastCat === 'massa') {
      return SCORE_BLOQUEADO;
    }
    if ((protCount[recipe.proteina] || 0) >= (config.max_proteina || 3)) {
      return SCORE_EXCESSO_PROTEINA;
    }

    // ── preferências suaves
    let score = SCORE_BASE;

    if (BONUS_ESTILO[ctx.estilo]) score += BONUS_ESTILO[ctx.estilo](recipe);

    if (ings.some(ing => promoNames.some(p => looseMatch(ing, p)))) {
      score += PESOS.promocao;
    }

    const emEstoque = ings.filter(ing => getStock(ctx.estoque, ing) > 0).length;
    score += Math.min(emEstoque * PESOS.estoquePorItem, PESOS.estoqueTeto);

    if (lastTwo.includes(recipe.id)) score += PESOS.recencia;
    if ((protCount[recipe.proteina] || 0) >= 2) score += PESOS.repeticaoProteina;

    score += rng() * PESOS.jitter - PESOS.jitter / 2;
    return score;
  }

  /**
   * Escolhe a receita do próximo dia.
   *
   * Sorteia entre as três melhores em vez de pegar a de maior nota:
   * escolha gulosa produziria a mesma semana em toda execução com a mesma
   * configuração, o que anula o propósito de um planejador.
   */
  function selectRecipe(recipes, ctx) {
    const rng = ctx.rng || Math.random;
    const scored = recipes
      .map(r => ({ r, s: scoreReceita(r, ctx) }))
      .filter(x => x.s > -900)
      .sort((a, b) => b.s - a.s);

    if (!scored.length) return recipes[Math.floor(rng() * recipes.length)];
    const top = scored.slice(0, Math.min(3, scored.length));
    return top[Math.floor(rng() * top.length)].r;
  }

  // ───────────────────────────────── lista de compras

  /** Gramas de um ingrediente de receita, respeitando a unidade declarada. */
  function ingredientGrams(ing) {
    if (typeof ing !== 'object') return 150;
    return ing.q * (UNIT_TO_GRAMS[ing.u] || 1);
  }

  /** Soma a necessidade de cada ingrediente do plano, em gramas. */
  function calcNeeds(plano, config) {
    const needs = {};

    for (const day of plano || []) {
      const r = day.receita;
      const scale = day.lotes * (day.porcoes / (r.porcoes || 4));
      for (const ing of (r.ings || [])) {
        const nm = typeof ing === 'object' ? ing.n : ing;
        needs[nm] = (needs[nm] || 0) + ingredientGrams(ing) * scale;
      }
    }

    if (config && config.frutas) {
      const tot = config.dias * config.moradores;
      const frutas = { 'banana': tot * 0.4 * 120, 'maçã': tot * 0.35 * 180, 'mamão': tot * 0.25 * 200 };
      for (const [k, v] of Object.entries(frutas)) needs[k] = (needs[k] || 0) + v;
    }

    return needs;
  }

  function formatQty(item, buyG) {
    const buyKg = buyG / 1000;
    if (item === 'ovos') return `${Math.ceil(buyG / 100)} un`;
    if (item === 'atum') {
      const n = Math.ceil(buyG / 100);
      return `${n} lata${n > 1 ? 's' : ''}`;
    }
    if (item === 'alface') return `${Math.ceil(buyG / 150)} un`;
    return buyKg >= 1 ? `${buyKg.toFixed(1)} kg` : `${Math.round(buyG)} g`;
  }

  /**
   * Lista de compras derivada do plano, agrupada por corredor.
   *
   * Para cada ingrediente: necessidade menos estoque, convertida em preço
   * (promocional quando houver). Itens sem corredor conhecido caem em "Outros".
   *
   * @param {object} state {plano, config, estoque, precos, promocoes}
   */
  function calcShoppingList(state) {
    const { plano, config, estoque, precos, promocoes } = state;
    const needs = calcNeeds(plano, config);
    const assigned = new Set();
    const result = [];

    const buildItem = (item, neededG, corredor) => {
      const stockG = getStock(estoque, item);
      const buyG = Math.max(0, neededG - stockG);
      if (buyG < MIN_COMPRA_G) return null;
      const buyKg = buyG / 1000;
      return {
        nome: item,
        buyG,
        buyKg,
        qty_display: formatQty(item, buyG),
        custo: buyKg * getPrice(precos, promocoes, item),
        stockG,
        emPromocao: (promocoes || []).some(p => looseMatch(item, p.nome.toLowerCase())),
        corredor
      };
    };

    for (const [corredor, items] of Object.entries(CORREDORES)) {
      const catItems = [];
      for (const item of items) {
        if (!needs[item]) continue;
        assigned.add(item);
        const built = buildItem(item, needs[item], corredor);
        if (built) catItems.push(built);
      }
      if (catItems.length) result.push({ cat: corredor, items: catItems });
    }

    const otherItems = [];
    for (const [item, neededG] of Object.entries(needs)) {
      if (assigned.has(item)) continue;
      const built = buildItem(item, neededG, 'Outros');
      if (built) {
        built.emPromocao = false;
        built.qty_display = built.buyKg >= 1
          ? `${built.buyKg.toFixed(1)} kg`
          : `${Math.round(built.buyG)} g`;
        otherItems.push(built);
      }
    }
    if (otherItems.length) result.push({ cat: '📦 Outros', items: otherItems });

    return result;
  }

  return {
    PRECOS_BASE, CORREDORES, ING_GRAMS, UNIT_TO_GRAMS,
    SCORE_BASE, SCORE_BLOQUEADO, SCORE_EXCESSO_PROTEINA, PESOS, BONUS_ESTILO,
    PRECO_PADRAO, GRAMAS_PADRAO, MIN_COMPRA_G,
    looseMatch, getStock, getPrice, ingGrams, ingNames,
    scoreReceita, selectRecipe,
    ingredientGrams, calcNeeds, formatQty, calcShoppingList
  };
});
