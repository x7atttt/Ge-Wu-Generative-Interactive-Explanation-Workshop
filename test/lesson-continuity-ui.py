import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from ui_controls import select_space

f = json.loads(Path('data/lesson-continuity-fixture.json').read_text(encoding='utf-8'))
BASE, MODEL = 'http://127.0.0.1:3100', 'http://127.0.0.1:3101'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1360, 'height': 1050}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    select_space(page, f['spaceId'])
    history = page.get_by_role('button', name='历史讲解', exact=False)
    history.click()
    expect(page.locator('[data-history-root]')).to_have_count(1)
    page.get_by_text(f['base']['title'], exact=True).click()
    expect(page.get_by_label('当前讲解版本', exact=True)).to_contain_text('已修订原文')
    expect(page.get_by_text('这是修订后的介绍。', exact=True)).to_be_visible()
    expect(page.get_by_text('先看模块，再看数据怎样流动', exact=True)).to_be_visible()
    page.get_by_role('button', name='查看原始讲解', exact=True).click()
    expect(page.get_by_text(f['base']['blocks'][1]['content'], exact=True)).to_be_visible()
    expect(page.get_by_text('这是修订后的介绍。', exact=True)).to_have_count(0)
    # Global history can open a lesson in its owning space.
    expect(page.locator('.diagram-canvas')).to_have_attribute('aria-busy', 'false', timeout=10000)
    page.get_by_role('combobox', name='切换空间', exact=True).press('ArrowDown')
    page.get_by_role('option', name='全局', exact=True).press('Enter')
    expect(page.get_by_role('combobox', name='切换空间', exact=True)).to_have_attribute('data-value', '')
    history.click()
    page.locator(f'[data-history-root="{f["rootId"]}"]').get_by_text(f['base']['title'], exact=True).click()
    expect(page.get_by_role('combobox', name='切换空间', exact=True)).to_have_attribute('data-value', str(f['spaceId']))
    expect(page.get_by_label('当前讲解版本', exact=True)).to_contain_text('已修订原文')
    page.get_by_role('button', name='查看原始讲解', exact=True).click()
    # Default supplement mode preserves the root, both immediately and after reload.
    mode = page.get_by_role('group', name='深化方式', exact=True)
    expect(mode.get_by_role('button', name='补充讲解', exact=True)).to_have_attribute('aria-pressed', 'true')
    page.request.post(MODEL + '/control', data=json.dumps({'outputs': [f['appended']]}))
    page.get_by_placeholder('或直接输入你想要的深化方向', exact=True).fill('补充上下文来源')
    page.get_by_role('button', name='深化', exact=True).click()
    expect(page.get_by_label('当前讲解版本', exact=True)).to_contain_text('已追加补充', timeout=20000)
    expect(page.get_by_text(f['base']['blocks'][1]['content'], exact=True)).to_be_visible()
    expect(page.get_by_text('这是新补充的解释，原来的讲解保留。', exact=True)).to_be_visible()
    expect(page.locator('.diagram-canvas')).to_have_attribute('aria-busy', 'false', timeout=10000)
    page.screenshot(path='data/lesson-supplement-desktop.png', full_page=True)
    page.reload()
    page.wait_for_load_state('networkidle')
    history.click()
    expect(page.locator('[data-history-root]')).to_have_count(1)
    page.get_by_placeholder('搜索标题或编号…', exact=True).fill(str(f['rootId']))
    expect(page.locator('[data-history-root]')).to_have_count(1)
    page.locator('[data-history-root] summary').click()
    expect(page.get_by_role('button', name='原始讲解', exact=False)).to_be_visible()
    page.screenshot(path='data/lesson-history-versions-desktop.png', full_page=True)
    page.get_by_text(f['base']['title'], exact=True).click()
    expect(page.get_by_label('当前讲解版本', exact=True)).to_contain_text('已追加补充')
    expect(page.get_by_text(f['base']['blocks'][1]['content'], exact=True)).to_be_visible()
    # A completed diagram must stay readable while later blocks are still streaming.
    slow = {**f['base'], 'title': '慢速流图示验收', 'blocks': [f['reactDiagram'], {'type': 'text', 'content': '后续解释仍在逐段返回。' * 1100}]}
    page.request.post(MODEL + '/control', data=json.dumps({'outputs': [slow], 'streamChunkSize': 64, 'streamChunkDelay': 25, 'streamPause': 1000}))
    page.get_by_placeholder('想搞懂什么概念？如：正弦波的频率、英语名词复数、快速排序', exact=True).fill('慢速流图示验收')
    web = page.get_by_role('button', name='联网检索', exact=True)
    if web.get_attribute('aria-pressed') == 'true':
        web.click()
    page.get_by_role('button', name='生成讲解', exact=True).click()
    expect(page.get_by_role('heading', name='慢速流图示验收', exact=True)).to_be_visible(timeout=10000)
    figure = page.get_by_role('figure', name=f['reactDiagram']['title'], exact=True)
    expect(figure.locator('.react-flow__node-lesson')).to_have_count(6, timeout=20000)
    expect(figure.locator('.diagram-canvas')).to_have_attribute('aria-busy', 'false', timeout=10000)
    figure.scroll_into_view_if_needed()
    page.wait_for_function('''() => {
      const c=document.querySelector('.diagram-canvas'), r=c?.getBoundingClientRect();
      return r && [...c.querySelectorAll('.react-flow__node-lesson')].every(n=>{
        const b=n.getBoundingClientRect(),s=getComputedStyle(n);
        return b.width>0 && s.visibility!=='hidden' && b.left>=r.left-1 && b.right<=r.right+1 && b.top>=r.top-1 && b.bottom<=r.bottom+1;
      });
    }''', timeout=10000)
    figure.evaluate('(el)=>window.continuityDiagram=el')
    for _ in range(8):
        expect(page.get_by_role('region', name='讲解生成进度', exact=True)).to_be_visible()
        assert figure.evaluate('(el)=>el===window.continuityDiagram'), '后续流片段不应重建已就绪图'
        assert figure.locator('.react-flow__node-lesson').evaluate_all('(ns)=>ns.every(n=>getComputedStyle(n).visibility!=="hidden")')
        expect(figure.locator('.diagram-canvas')).to_have_attribute('aria-busy', 'false')
        page.wait_for_timeout(150)
    figure.screenshot(path='data/diagram-streaming-visible-desktop.png')
    expect(page.get_by_role('button', name='生成讲解', exact=True)).to_be_enabled(timeout=25000)
    expect(figure.locator('.react-flow__node-lesson')).to_have_count(6)
    expect(figure.locator('.diagram-canvas')).to_have_attribute('aria-busy', 'false', timeout=10000)
    history.click()
    original = page.locator(f'[data-history-root="{f["rootId"]}"]')
    original.get_by_title('删除该讲解及其深化版本（不可恢复）', exact=True).click()
    page.get_by_role('alertdialog').get_by_role('button', name='删除讲解', exact=True).click()
    expect(original).to_have_count(0)
    assert not errors, errors
    browser.close()
print('PASS: grouped history/latest and original recovery, supplement persistence, and visible diagram during incremental streaming')
