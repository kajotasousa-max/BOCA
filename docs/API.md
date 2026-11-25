# API (Apps Script Web App)

Um único endpoint (`api` no `config.js`). Respostas em JSON com `ok: true|false` e, em erro, `erro`.
A senha vai no parâmetro `k` da URL. Sem senha válida: `{ ok:false, semAcesso:true }`. Operador fora do permitido: `{ ok:false, semPermissao:true }`.
POST com corpo JSON em texto puro (sem preflight CORS). Datas `yyyy-MM-dd`, horas `HH:mm`.

## GET `?action=`

| Ação | Acesso | Resposta |
|---|---|---|
| `painel` | público | `{ cheio, caixasPorCiclo, atualizado, sabores:[{ nome, estoque, produzidoHoje, vendidoHoje, ciclosHoje, situacao:'baixo'|'ok'|'alto', ciclos }] }` |
| `nivel` | operador | `{ nivel:'escritorio'|'operador'|'livre' }` |
| `dia&data=` | operador | `{ data, ciclos:[Ciclo], vendas:[{hora,sabor,caixas}], ajustes:[{sabor,caixas,motivo}], perda:{jarMl,powderG} }` |
| `periodo&de=&ate=` | escritório | `{ de, ate, dias:[{data,produzido,ciclos,vendido,jarMl,powderG}], porSabor:{ [sabor]:{produzido,vendido} } }` |

## POST `{ kind, data, ... }`

Toda gravação responde com o `dia` atualizado e `painel`.

| kind | Acesso | Campos |
|---|---|---|
| `producao` | operador | `ciclo: Ciclo` — reenviar com o mesmo `id` não duplica |
| `excluir-producao` | operador | `id` |
| `perda` | operador | `jarra`, `po` — uma linha por dia (substitui) |
| `venda` | escritório | `sabor`, `caixas` (negativo = desfazer) |
| `ajuste` | escritório | `sabor`, `caixas` (±), `motivo` |

```ts
Ciclo { id, flavor /* "S.02 - Morango" */, qty /* gelos */, caixas, startTime, endTime, machine, operator, shift, notes }
```
