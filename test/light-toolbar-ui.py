import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from ui_controls import select_space, space_picker

BASE = 'http://127.0.0.1:3100'
f = json.loads(Path('data/light-toolbar-fixture.json').read_text(encoding='utf-8'))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if 'Encountered two children with the same key' in message.text else None)
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    select_space(page, f['spaceId'])
    toolbar = page.locator('[data-toolbar]')
    manager = page.get_by_role('button', name='空间管理', exact=True)
    assert toolbar.get_by_role('combobox', name='切换空间').evaluate('(el)=>getComputedStyle(el).boxShadow') == 'none'
    assert manager.bounding_box()['x'] > page.get_by_role('button', name='联网检索', exact=True).bounding_box()['x']
    expect(page.get_by_text('建议回顾 0 张', exact=False)).to_have_count(0)
    page.screenshot(path='data/light-toolbar-desktop.png', full_page=True)

    source_button = page.get_by_title('批量导入文档资料，生成讲解时作为事实依据')
    source_button.click()
    drawer = page.get_by_role('dialog', name='资料库', exact=True)
    expect(drawer).to_be_visible()
    assert drawer.bounding_box()['x'] + drawer.bounding_box()['width'] == 1280
    assert drawer.evaluate('(node)=>node.contains(document.activeElement)')
    drawer.get_by_role('tab', name='当前空间', exact=False).press('ArrowRight')
    expect(drawer.get_by_role('tab', name='未分组', exact=False)).to_have_attribute('aria-selected', 'true')
    row = drawer.get_by_title(f['source']['title'], exact=True).locator('..')
    row.get_by_role('button', name='移入', exact=True).click()
    expect(row).to_have_count(0)
    drawer.get_by_role('tab', name='当前空间', exact=False).click()
    expect(drawer.get_by_title(f['source']['title'], exact=True)).to_be_visible()
    drawer.locator('input[type=file]').set_input_files({'name': f['uploadName'], 'mimeType': 'text/plain', 'buffer': b'Stack is last in first out.'})
    expect(drawer.get_by_title(f['uploadName'].removesuffix('.txt'), exact=True)).to_be_visible()
    # Portal 内拖入资料不应激活主输入区；只导入一次，且关闭后没有残留遮罩。
    drop_hint = page.get_by_text('松开添加：图片 → 讲解附图 · txt / md / pdf / doc → 资料库并自动附加', exact=True)
    drag_name = 'drag-' + f['uploadName']
    transfer = page.evaluate_handle('''name => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['Drawer drag regression.'], name, {type: 'text/plain'}));
        return transfer;
    }''', drag_name)
    # 上传区之外的抽屉区域也不能冒泡成主输入区上传。
    header = drawer.get_by_role('heading', name='资料库', exact=True)
    header.dispatch_event('dragenter', {'dataTransfer': transfer})
    header.dispatch_event('dragover', {'dataTransfer': transfer})
    header.dispatch_event('drop', {'dataTransfer': transfer})
    header.dispatch_event('dragleave', {'dataTransfer': transfer})
    page.wait_for_load_state('networkidle')
    expect(drawer.get_by_title(drag_name.removesuffix('.txt'), exact=True)).to_have_count(0)
    expect(drop_hint).to_have_count(0)
    upload = drawer.locator('div.border-dashed')
    upload.dispatch_event('dragenter', {'dataTransfer': transfer})
    upload.get_by_text('添加参考资料', exact=True).dispatch_event('dragenter', {'dataTransfer': transfer})
    upload.get_by_text('添加参考资料', exact=True).dispatch_event('dragleave', {'dataTransfer': transfer})
    expect(drop_hint).to_have_count(0)
    upload.dispatch_event('dragover', {'dataTransfer': transfer})
    upload.dispatch_event('drop', {'dataTransfer': transfer})
    expect(drawer.get_by_title(drag_name.removesuffix('.txt'), exact=True)).to_be_visible()
    expect(drop_hint).to_have_count(0)
    imported = page.request.get(f'{BASE}/api/sources').json()['sources']
    assert len([source for source in imported if source['title'] == drag_name.removesuffix('.txt')]) == 1
    transfer.dispose()
    drawer.get_by_role('button', name='查看与纠错', exact=True).first.click()
    editor = page.get_by_role('dialog', name='查看与纠正资料', exact=True)
    expect(editor).to_be_visible()
    expect(editor.get_by_role('textbox', name='解析正文（纯文本 / Markdown）', exact=True)).to_be_visible()
    page.keyboard.press('Escape')
    expect(editor).to_have_count(0)
    expect(drawer).to_be_visible()
    drawer.get_by_role('button', name='附加', exact=True).first.click()
    page.screenshot(path='data/light-toolbar-sources.png', full_page=True)
    page.keyboard.press('Escape')
    expect(drawer).to_have_count(0)
    expect(source_button).to_be_focused()
    expect(drop_hint).to_have_count(0)

    # 主输入区仍支持拖入文档并自动附加，子节点切换/离开后正确清理提示。
    hero = source_button.locator('xpath=ancestor::section[1]')
    transfer = page.evaluate_handle('''name => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['Hero drag regression.'], name, {type: 'text/plain'}));
        return transfer;
    }''', 'hero-' + f['uploadName'])
    hero.dispatch_event('dragenter', {'dataTransfer': transfer})
    expect(drop_hint).to_be_visible()
    hero.locator('input').first.dispatch_event('dragenter', {'dataTransfer': transfer})
    hero.locator('input').first.dispatch_event('dragleave', {'dataTransfer': transfer})
    expect(drop_hint).to_be_visible()
    hero.dispatch_event('dragleave', {'dataTransfer': transfer})
    expect(drop_hint).to_have_count(0)
    hero.dispatch_event('dragenter', {'dataTransfer': transfer})
    hero.dispatch_event('dragover', {'dataTransfer': transfer})
    hero.dispatch_event('drop', {'dataTransfer': transfer})
    expect(drop_hint).to_have_count(0)
    expect(page.get_by_text('已导入 1 份资料并附加', exact=True)).to_be_visible()
    expect(source_button).to_have_text('资料 2')
    imported = page.request.get(f'{BASE}/api/sources').json()['sources']
    assert len([source for source in imported if source['title'] == ('hero-' + f['uploadName']).removesuffix('.txt')]) == 1
    transfer.dispose()

    for width in [925, 714, 390]:
        page.set_viewport_size({'width': width, 'height': 900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        source_button.click()
        expect(drawer).to_be_visible()
        page.keyboard.press('Tab')
        assert drawer.evaluate('(node)=>node.contains(document.activeElement)')
        bounds = drawer.bounding_box()
        assert bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= width
        if width == 390:
            page.screenshot(path='data/light-toolbar-mobile-sources.png', full_page=True)
        drawer.get_by_role('button', name='关闭资料', exact=True).click()
        expect(drawer).to_have_count(0)
    manager.click()
    bounds = page.get_by_role('heading', name='空间管理', exact=True).locator('..').bounding_box()
    assert bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= 390
    page.keyboard.press('Escape')
    expect(page.get_by_role('heading', name='空间管理', exact=True)).to_have_count(0)
    page.screenshot(path='data/light-toolbar-mobile.png', full_page=True)
    page.set_viewport_size({'width': 1280, 'height': 900})

    # 完整 JSON 已收到但上游仍未结束时，停顿不得被误判为校验。
    page.request.post('http://127.0.0.1:3101/control', data={'outputs': [f['invalid'], f['valid']], 'streamPause': 2600, 'repairDelay': 2200})
    page.get_by_role('button', name='联网检索', exact=True).click()
    concept = page.get_by_placeholder('留空则围绕第一份资料/图片生成，或输入具体概念', exact=True)
    concept.fill('队列与栈')
    with page.expect_response(lambda response: response.url.endswith('/api/generate')) as generated:
        page.get_by_role('button', name='生成讲解', exact=True).click()
    progress = page.get_by_role('progressbar')
    expect(progress).to_have_attribute('data-stage', 'build')
    page.wait_for_timeout(1450)
    expect(progress).to_have_attribute('data-stage', 'build')
    assert progress.get_attribute('aria-valuenow') is None
    expect(page.get_by_role('region', name='讲解生成进度').locator('details')).not_to_have_attribute('open', '')
    page.screenshot(path='data/light-toolbar-generating.png', full_page=True)
    expect(progress).to_have_attribute('data-stage', 'repair', timeout=8000)
    expect(page.get_by_text('正在调整讲解内容', exact=True)).to_be_visible()
    page.screenshot(path='data/light-toolbar-repair.png', full_page=True)
    expect(progress).to_have_count(0, timeout=10000)
    expect(page.get_by_role('button', name='生成讲解', exact=True)).to_be_enabled()
    events = [json.loads(line[6:]) for line in generated.value.text().splitlines() if line.startswith('data: ')]
    assert [event['stage'] for event in events if event['type'] == 'stage'] == ['build', 'verify', 'repair', 'verify']

    # reduced motion 与取消均走实际生成路径，取消不得落库。
    before = len(page.request.get(f'{BASE}/api/docs?spaceId={f["spaceId"]}').json()['docs'])
    page.emulate_media(reduced_motion='reduce')
    page.request.post('http://127.0.0.1:3101/control', data={'delay': 2500, 'outputs': [f['valid']]})
    page.get_by_role('button', name='生成讲解', exact=True).click()
    expect(progress).to_be_visible()
    assert progress.locator('span').evaluate('(el)=>getComputedStyle(el).animationName') == 'none'
    page.get_by_role('button', name='取消生成', exact=True).click()
    expect(page.get_by_text('已取消本次生成', exact=True)).to_be_visible()
    page.wait_for_timeout(2800)
    assert len(page.request.get(f'{BASE}/api/docs?spaceId={f["spaceId"]}').json()['docs']) == before
    assert not errors, errors
    print('PASS: toolbar hierarchy/right alignment, drawer import/move/editor/focus, desktop/narrow, real stream pause/repair stages, cancellation and reduced motion')
    browser.close()
