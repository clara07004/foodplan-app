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

  /** Normaliza para comparação: minúsculas, sem espaço sobrando. */
  function normalize(name) {
    return String(name == null ? '' : name).toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /** Casamento frouxo por substring, nos dois sentidos. */
  function looseMatch(a, b) {
    return a === b || a.includes(b) || b.includes(a);
  }

  /**
   * `longo` é `curto` seguido de um qualificador?
   *
   * "batata doce" é variante qualificada de "batata"; "alho-poró" de "alho";
   * "couve-flor" de "couve". São ingredientes DIFERENTES — e era exatamente
   * daí que vinha o erro de resolver o preço de um para o do outro.
   */
  function isQualifiedVariant(longo, curto) {
    if (longo === curto || !longo.startsWith(curto)) return false;
    return /[\s\-]/.test(longo.charAt(curto.length));
  }

  /** Vocabulário canônico: tudo que o app sabe nomear. */
  const KNOWN_INGREDIENTS = new Set(
    [].concat(Object.keys(PRECOS_BASE), Object.keys(ING_GRAMS)).map(normalize)
  );

  /**
   * O candidato deve ser recusado como casamento da consulta?
   *
   * Cobre os dois sentidos em que um qualificador distingue ingredientes:
   *
   *   consulta "alho"        · candidato "alho-poró"  → recusa
   *   consulta "batata doce" · candidato "batata"     → recusa
   *
   * Só recusa quando o app sabe nomear a consulta. Nome livre que ele não
   * conhece continua caindo no ingrediente base, para que "arroz agulhinha"
   * ainda encontre "arroz".
   */
  function rejectMatch(q, c) {
    if (q === c) return false;
    if (!KNOWN_INGREDIENTS.has(q)) return false;
    // o candidato é uma forma mais específica do que se pediu
    if (isQualifiedVariant(c, q)) return true;
    // pediu-se a forma específica e o candidato é a base, também catalogada
    if (isQualifiedVariant(q, c) && KNOWN_INGREDIENTS.has(c)) return true;
    return false;
  }

  /**
   * Resolve o nome consultado contra uma lista de candidatos.
   *
   *   1. nome exato sempre vence — é o que corrige a resolução de preço
   *   2. casamento frouxo como fallback, exceto quando o candidato é uma
   *      variante qualificada de uma consulta que o app já sabe nomear
   *   3. entre os que sobram, o de tamanho mais próximo da consulta
   *
   * A regra 2 erra para o lado seguro de propósito: deixar de creditar
   * estoque faz comprar um pouco a mais, enquanto creditar errado faz
   * faltar comida.
   *
   * @param {string} query
   * @param {Array} candidates
   * @param {function} [nameOf] extrai o nome do candidato; padrão é ele mesmo
   * @returns {*} o candidato escolhido, ou undefined
   */
  function resolveName(query, candidates, nameOf) {
    const q = normalize(query);
    const get = nameOf || (c => c);
    const pool = (candidates || []).map(c => ({ raw: c, n: normalize(get(c)) }));

    const exato = pool.find(c => c.n === q);
    if (exato) return exato.raw;

    const viaveis = pool.filter(c => looseMatch(q, c.n) && !rejectMatch(q, c.n));
    if (!viaveis.length) return undefined;

    viaveis.sort((a, b) =>
      Math.abs(a.n.length - q.length) - Math.abs(b.n.length - q.length));
    return viaveis[0].raw;
  }

  // ───────────────────────────────── estoque e preço

  /** Quantidade em gramas do item disponível em estoque. 0 se não houver. */
  function getStock(estoque, item) {
    const found = resolveName(item, estoque, e => e.nome);
    if (!found) return 0;
    return found.qty * (UNIT_TO_GRAMS[found.unit] || 1);
  }

  /** Preço por kg. Promoção vence a tabela; sem nenhum dos dois, PRECO_PADRAO. */
  function getPrice(precos, promocoes, item) {
    const prom = resolveName(item, promocoes, p => p.nome);
    if (prom && prom.preco > 0) return prom.preco;
    const k = resolveName(item, Object.keys(precos || {}));
    return k !== undefined ? precos[k] : PRECO_PADRAO;
  }

  /** Gramas por porção do ingrediente. */
  function ingGrams(name) {
    const k = resolveName(name, Object.keys(ING_GRAMS));
    return k !== undefined ? ING_GRAMS[k] : GRAMAS_PADRAO;
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

    if (ings.some(ing => resolveName(ing, promoNames) !== undefined)) {
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
        emPromocao: resolveName(item, promocoes, p => p.nome) !== undefined,
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
    normalize, looseMatch, isQualifiedVariant, rejectMatch, resolveName, KNOWN_INGREDIENTS,
    getStock, getPrice, ingGrams, ingNames,
    scoreReceita, selectRecipe,
    ingredientGrams, calcNeeds, formatQty, calcShoppingList
  };
});
