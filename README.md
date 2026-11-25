# Boca Gelada — Produção, Estoque e Vendas

Sistema web da fábrica de gelo saborizado Boca Gelada. O operador aponta cada ciclo no celular, o vendedor lança as vendas, e o estoque de cada sabor sobe e desce na hora. O monitor da fábrica mostra o que precisa produzir.

Roda em qualquer navegador, sem instalação. O site é estático (GitHub Pages) e os dados ficam na planilha Google **PRODUÇÃO BOCA GELADA**, aba **HISTÓRICO**, por meio do Apps Script.

## Telas

| Aba | Quem usa | O que faz |
|---|---|---|
| 📦 **Estoque** | todos | Barras por sabor (traço = cheio), "produzir N ciclos, começar por…", ocupação dos freezers, ajuste de estoque (só escritório) |
| 🏭 **Produção** | operador | Gestão Diária: sabor, formas (19 = cheio), hora início/fim, observação, desperdício (jarra e pó), resumo do dia |
| 💰 **Vendas** | escritório | Toca no sabor, escolhe as caixas, lança. "Desfazer" devolve ao estoque |
| 📅 **Histórico** | escritório | Gráfico produzido × vendido por dia, detalhes de qualquer dia, totais por sabor, CSV |
| 📺 **Monitor** (`#tv`) | fábrica | Tela cheia escura para a TV, sem senha, atualiza a cada 30 s |

## Regras

- 1 ciclo = 19 formas × 16 = 304 gelos ≈ 10 caixas (caixa = 30 gelos).
- Estoque de cada sabor = **cheio** (VENDAS!D3, 39 cx) + produzido − vendido ± ajustes.
- **Baixo** = abaixo de 50% do cheio. **Produzir** = caixas que faltam para o cheio ÷ 10, arredondado para cima.
- Sem internet, o celular do operador guarda os ciclos (badge ⏳) e envia sozinho quando a conexão volta.

## Estrutura

```
index.html            página única (todas as telas e o monitor)
config.js             link do Apps Script, máquina, capacidade, cores dos sabores
css/styles.css
js/app.js
backend/Code.gs       Apps Script da planilha (API + menu de senhas + VENDAS na planilha)
docs/                 instalação e contrato da API
testes/               backend simulado e teste de ponta a ponta (Playwright)
```

## Senhas

Menu **Boca Gelada** na planilha:

- **Escritório**: tudo.
- **Operador**: só aponta produção e desperdício (e vê o estoque).
- O monitor (`#tv`) abre sem senha: só mostra o estoque.

O Apps Script guarda só o hash da senha. Cada aparelho digita uma vez; **sair** esquece.

Instalação passo a passo: [docs/INSTALACAO.md](docs/INSTALACAO.md).
