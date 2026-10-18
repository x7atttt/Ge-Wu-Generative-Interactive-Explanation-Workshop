from playwright.sync_api import expect

def space_picker(page):
    return page.get_by_role('combobox', name='切换空间', exact=True)

def select_space(page, value):
    if page.get_by_role('heading', name='空间管理', exact=True).is_visible():
        page.keyboard.press('Escape')
        expect(page.get_by_role('heading', name='空间管理', exact=True)).to_have_count(0)
    trigger = space_picker(page)
    trigger.click()
    page.get_by_role('listbox', name='切换空间', exact=True).locator(f'[role="option"][data-value="{value}"]').click()
    expect(trigger).to_have_attribute('data-value', str(value))

def expect_space_absent(page, value):
    trigger = space_picker(page)
    trigger.press('ArrowDown')
    menu = page.get_by_role('listbox', name='切换空间', exact=True)
    expect(menu).to_be_visible()
    expect(menu.locator(f'[role="option"][data-value="{value}"]')).to_have_count(0)
    trigger.press('Escape')


def open_current_space_delete(page):
    heading = page.get_by_role('heading', name='空间管理', exact=True)
    if heading.count():
        page.keyboard.press('Escape')
        expect(heading).to_have_count(0)
    page.get_by_title('空间管理：查看所有空间与资料归属、新建/重命名/删除/移动').click()
    expect(heading).to_be_visible()
    row = heading.locator('..').locator('div.rounded-lg.border.border-stone-100').filter(has=page.get_by_text('当前', exact=True))
    row.get_by_role('button', name='删除', exact=True).click()
