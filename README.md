# FoodPlan

Planejador semanal de refeições com otimização de custo, consciência de estoque e substituição orientada a promoções. Empacotado como aplicativo Android via Capacitor.

## O problema

Planejar a semana de refeições envolve três restrições que competem entre si: orçamento, variedade e o que já existe na despensa. Resolver isso de cabeça leva a duas falhas previsíveis — comprar o que já se tem em casa, e repetir o mesmo prato porque é o que vem à memória primeiro.

O FoodPlan trata o planejamento como um problema de seleção sob restrição, não como uma lista para preencher à mão.

## Como o plano é gerado

Cada receita recebe uma nota para cada dia da semana. As restrições estão separadas em duas classes, e essa separação é o núcleo do projeto.

**Restrições rígidas** — eliminam a receita do conjunto de candidatas:

- ingrediente presente na lista de bloqueio do usuário
- filtro vegetariano ativo e receita com proteína animal
- massa em dois dias consecutivos
- proteína já usada acima do limite configurado

**Preferências suaves** — entram na nota, partindo de uma base de 50:

| Fator | Peso |
|---|---|
| Usa ingrediente em promoção | +35 |
| Ingrediente já disponível em estoque | +5 cada, teto de 25 |
| Bônus por estilo alimentar (econômico, fit, low-carb) | +10 a +30 |
| Usada nos últimos dois dias | −60 |
| Proteína já repetida duas vezes | −25 |

A seleção final **não escolhe a receita de maior nota** — sorteia entre as três melhores.

Isso é deliberado. Seleção gulosa pelo maior score produziria exatamente a mesma semana em toda execução com a mesma configuração, o que anula o propósito de um planejador. Sortear entre as melhores candidatas preserva a qualidade da escolha e devolve variedade entre semanas.

## Lista de compras

A lista é derivada do plano, nunca digitada:

1. soma a necessidade de cada ingrediente, escalada por número de lotes e porções
2. subtrai o que já existe no estoque cadastrado
3. agrupa os itens por corredor de supermercado
4. aplica preço promocional quando houver
5. compara o total com o orçamento configurado

O resultado é uma lista na ordem em que se caminha pelo mercado, com o custo estimado antes de sair de casa.

## Configuração disponível

Número de moradores, dias a planejar, refeições por dia, marmitas por dia, orçamento semanal, custo de referência de delivery (usado para calcular a economia), limite de repetição da mesma proteína, estilo alimentar e lista de ingredientes bloqueados.

## Stack

HTML, CSS e JavaScript sem dependência de runtime. Capacitor 6 para o empacotamento Android. Persistência local via `localStorage`.

Sem etapa de build, por decisão de projeto: o aplicativo é um arquivo único, e atualizar significa trocar o HTML e rodar `npx cap copy android`. Para o escopo deste projeto, uma cadeia de build adicionaria manutenção sem resolver nenhum problema real.

## Números

- 31 receitas padrão, com quantidade por ingrediente em gramas
- base de 44 preços de referência, editável pelo usuário
- 9 corredores de supermercado
- 9 telas
- 941 linhas de JavaScript

## Rodar

```bash
npm install
npx cap add android
npx cap copy android
npx cap open android
```

No Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

O passo a passo completo, incluindo instalação do Android Studio, configuração do `ANDROID_HOME` e instalação no aparelho, está em [GUIA_APK.md](GUIA_APK.md).

## Limitações conhecidas

- **Casamento de ingredientes por substring.** A comparação entre nome de ingrediente, item de estoque e item em promoção usa `includes` nos dois sentidos, o que gera falso positivo em nomes próximos (`cebola` casa com `cebolinha`). Um identificador normalizado por ingrediente resolveria.
- **Sem migração de schema.** O estado salvo em `localStorage` é mesclado no estado padrão sem validação de versão, então dados gravados por uma versão anterior podem sobreviver com campos faltando.
- **Sem testes automatizados.** As funções de pontuação e de cálculo da lista de compras são praticamente puras e são o próximo passo natural.
- **Preços são de referência manual**, não integrados a nenhuma fonte externa.

## Autoria

Anna Clara Barbosa — [github.com/clara07004](https://github.com/clara07004)
