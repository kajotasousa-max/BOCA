# Instalação

## 1. Apps Script (uma vez)

1. Abra a planilha **PRODUÇÃO BOCA GELADA** › **Extensões › Apps Script**.
2. Apague tudo que estiver no `Código.gs` (e outros arquivos antigos, como `Celular.html`) e cole o `backend/Code.gs`. Salve.
3. **Implantar › Nova implantação** › engrenagem › **App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
4. Autorize com a conta Google. Copie o link que termina em `/exec`.
5. Recarregue a planilha. Aparece o menu **Boca Gelada**: defina a **senha do escritório** e a **senha do operador**.

> Mudou o `Code.gs` depois? Cole a versão nova e vá em **Implantar › Gerenciar implantações › Editar (lápis) › Versão: Nova versão**. Assim o link continua o mesmo.

## 2. Site

1. Coloque o link `/exec` em `api` no `config.js` e faça o commit.
2. No GitHub: **Settings › Pages › Branch `main` / `(root)` › Save**.
3. Endereços:
   - Sistema: `https://kajotasousa-max.github.io/BOCA/`
   - Monitor da fábrica: `https://kajotasousa-max.github.io/BOCA/#tv` (abra no navegador da TV e aperte F11)

No celular, abra o link e use **Adicionar à tela inicial**.

## Onde ficam os dados (aba HISTÓRICO)

| Colunas | Bloco |
|---|---|
| A:D | Vendas — DATA, HORA, SABOR, CAIXAS (desfeita = negativa) |
| I:S | Produção — DATA, HORA FIM, SABOR, QTD (un), CAIXAS, MÁQUINA, INÍCIO, OPERADOR, TURNO, OBS, ID |
| U:W | Desperdício — DATA, JARRA (ml), PÓ (g) |
| Y:AB | Ajustes — DATA, SABOR, CAIXAS (±), MOTIVO |

As abas **VENDAS** e **OPERADOR** da planilha leem daqui, então continuam funcionando. Digitar em "VENDI AGORA" na aba VENDAS também lança a venda.

## Problemas comuns

| Sintoma | Causa |
|---|---|
| "Sem conexão com a planilha" | Link errado no `config.js`, ou implantação não está como "Qualquer pessoa" |
| Badge ⏳ não zera | Celular sem internet; envia sozinho quando voltar |
| "Sabor não cadastrado" | O nome do sabor mudou na aba Cadastros (J5:J34) |
| Pede senha de novo | A senha foi trocada no menu Boca Gelada |
