import json, os, sys, urllib.request
from playwright.sync_api import sync_playwright
B='http://localhost:8790'
def hist(): return json.loads(urllib.request.urlopen(B+'/__hist').read())
with sync_playwright() as p:
    br=p.chromium.launch()
    ctx=br.new_context(viewport={'width':400,'height':860}, locale='pt-BR')
    pg=ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('dialog',lambda d:d.accept())
    pg.goto(B+'/'); pg.wait_for_timeout(600)
    print('login visível:', pg.is_visible('#login'))
    pg.fill('#senha','errada1'); pg.click('#entrar'); pg.wait_for_timeout(600)
    print('erro:', pg.inner_text('#login-erro'))
    pg.fill('#senha','escrit1'); pg.click('#entrar'); pg.wait_for_timeout(800)
    print('perfil:', pg.inner_text('#perfil'), '| produzir:', pg.inner_text('#produzir')[:60])
    print('total:', pg.inner_text('#e-total'))
    pg.screenshot(path='/tmp/s1-estoque.png', full_page=True)
    # produção
    pg.click('#tabs [data-tab=producao]')
    pg.fill('#p-operador','Matheus'); pg.dispatch_event('#p-operador','change')
    pg.click('#p-turno button >> nth=0')
    pg.click('#p-sabores .fchip >> nth=1')
    pg.fill('#p-inicio','08:00'); pg.fill('#p-fim','08:32')
    pg.click('#p-salvar'); pg.wait_for_timeout(700)
    pg.click('#p-sabores .fchip >> nth=1'); pg.click('[data-formas="-1"]'); pg.click('#p-salvar'); pg.wait_for_timeout(700)
    print('ciclos:', pg.inner_text('#p-count'), '| prox inicio:', pg.input_value('#p-inicio'), '| resumo:', pg.inner_text('#r-prod'))
    pg.fill('#w-jarra','400'); pg.fill('#w-po','150'); pg.wait_for_timeout(2200)
    pg.screenshot(path='/tmp/s2-producao.png', full_page=True)
    # vendas
    pg.click('#tabs [data-tab=vendas]')
    pg.click('#v-sabores .fchip >> nth=1'); pg.click('[data-cxset="5"]'); pg.click('#v-salvar'); pg.wait_for_timeout(700)
    pg.click('#v-sabores .fchip >> nth=0'); pg.click('[data-cxset="30"]'); pg.click('#v-salvar'); pg.wait_for_timeout(700)
    pg.click('[data-estorno] >> nth=0'); pg.wait_for_timeout(700)
    print('vendas total:', pg.inner_text('#v-total'))
    pg.screenshot(path='/tmp/s3-vendas.png', full_page=True)
    # ajuste
    pg.click('#tabs [data-tab=estoque]')
    pg.select_option('#aj-sabor', index=1); pg.fill('#aj-cx','-2'); pg.fill('#aj-motivo','quebrou'); pg.click('#aj-salvar'); pg.wait_for_timeout(700)
    barras=pg.locator('#barras .sbar').all_inner_texts()
    print('barras 0..1:', [b.replace('\n',' ') for b in barras[:2]])
    # histórico
    pg.click('#tabs [data-tab=historico]'); pg.wait_for_timeout(900)
    print('hist tot:', pg.inner_text('#h-tot'))
    pg.click('#h-dias tr[data-dia] >> nth=0'); pg.wait_for_timeout(800)
    print('detalhe linhas:', pg.locator('#h-detalhe tbody tr').count())
    pg.screenshot(path='/tmp/s4-hist.png', full_page=True)
    # excluir ciclo
    pg.click('#tabs [data-tab=producao]'); pg.click('#p-lista [data-del] >> nth=0'); pg.wait_for_timeout(700)
    print('após excluir:', pg.inner_text('#p-count'))
    # operador em outro celular
    c2=br.new_context(viewport={'width':400,'height':860}); p2=c2.new_page(); p2.on('pageerror',lambda e:errs.append(str(e)))
    p2.goto(B+'/'); p2.wait_for_timeout(500); p2.fill('#senha','1234'); p2.click('#entrar'); p2.wait_for_timeout(800)
    print('operador abas visíveis:', [b.inner_text() for b in p2.locator('#tabs button').all() if b.is_visible()], '| tab:', p2.is_visible('#tab-producao'))
    # TV
    t=br.new_page(viewport={'width':1600,'height':900}); t.goto(B+'/#tv'); t.wait_for_timeout(900)
    print('tv:', t.inner_text('#tv-total'), t.inner_text('#tv-prod'), t.inner_text('#tv-vend'))
    t.screenshot(path='/tmp/s5-tv.png', full_page=True)
    print('HIST:'); [print(r[:4], r[8:19], r[20:23], r[24:28]) for r in hist()[3:8]]
    print('errs:', errs)
    br.close()
