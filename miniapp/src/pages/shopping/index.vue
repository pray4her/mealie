<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh } from '@dcloudio/uni-app';
import WdCheckbox from '@wot-ui/ui/components/wd-checkbox/wd-checkbox.vue';
import WdPopup from '@wot-ui/ui/components/wd-popup/wd-popup.vue';
import WdCell from '@wot-ui/ui/components/wd-cell/wd-cell.vue';
import WdCellGroup from '@wot-ui/ui/components/wd-cell-group/wd-cell-group.vue';
import type { ShoppingItem } from 'home-contracts';
import HomeAction from '../../components/HomeAction.vue';
import { usePageTypography } from '../../shared/use-page-typography';
import { useShoppingPage } from '../../features/shopping/use-shopping-page';
const { rootFontSize } = usePageTypography(); const choosing = ref(false);
const page = useShoppingPage(async () => { choosing.value = false; await page.shopping.refresh(); });
const { shopping, confirmed, busy, message } = page;
const { selected, selectedId, lists, listsCursor, items, itemsCursor, pending } = shopping;
const groups = computed(() => [{ title: '还要采购', checked: false, rows: items.value.filter(row => !row.checked) }, { title: '已经买好', checked: true, rows: items.value.filter(row => row.checked) }]);
const pendingFor = (row: ShoppingItem) => pending.value.find(value => 'id' in value.input && value.input.id === row.id && 'listId' in value.input && value.input.listId === row.listId);
const rowBusy = (row: ShoppingItem) => !!shopping.busy.value['item:' + row.listId + ':' + row.id];
const amount = (row: ShoppingItem) => row.quantity === null ? row.unit ?? '数量未注明' : row.quantity + (row.unit ? ' ' + row.unit : '');
function editList() { if (page.isCurrent()) uni.navigateTo({ url: '/pages/shopping/list-edit' + (selectedId.value ? '?id=' + selectedId.value : '') }); }
function addList() { if (page.isCurrent()) { choosing.value = false; uni.navigateTo({ url: '/pages/shopping/list-edit' }); } }
function editItem(row?: ShoppingItem) { if (page.isCurrent() && selectedId.value) uni.navigateTo({ url: '/pages/shopping/item-edit?listId=' + selectedId.value + (row ? '&id=' + row.id : '') }); }
const check = (row: ShoppingItem) => page.act(async () => {
  if (rowBusy(row) || pendingFor(row)) return;
  await shopping.write('setChecked', { id: row.id, listId: row.listId, version: row.version, checked: !row.checked });
}, false);
async function choose(listId: string) { await page.act(async () => { choosing.value = false; await shopping.select(listId); }); }
onPullDownRefresh(async () => { try { await page.act(() => shopping.refresh()); } finally { uni.stopPullDownRefresh(); } });
</script>

<template>
  <page-meta :root-font-size="rootFontSize" />
  <view class="page shopping-page">
    <view
      v-if="!confirmed"
      class="shopping-status"
    >
      <text>正在确认家庭信息…</text><HomeAction
        label="重试读取"
        variant="text"
        @click="page.check"
      >
        重试
      </HomeAction>
    </view>
    <template v-else>
      <text class="shopping-kicker">
        家人一起买，做饭更轻松
      </text>
      <view class="shopping-heading">
        <text class="shopping-title">
          购物清单
        </text><HomeAction
          label="新建清单"
          variant="text"
          data-new-list
          @click="addList"
        >
          新建
        </HomeAction>
      </view>
      <view
        v-if="message || shopping.readError.value"
        class="shopping-status"
        data-message
      >
        <text>{{ message || '操作已确认，暂时无法读取最新清单，请重试读取。' }}</text>
        <HomeAction
          label="重试读取"
          variant="text"
          data-read-retry
          :disabled="busy"
          @click="page.act(() => shopping.refresh())"
        >
          重试读取
        </HomeAction>
      </view>
      <view
        v-for="command in pending"
        :key="command.input.requestId"
        class="shopping-status"
        data-pending
      >
        <text>上次{{ command.kind === 'setChecked' ? '勾选' : '清单操作' }}结果尚未确认，请恢复原请求。</text>
        <HomeAction
          label="恢复原请求"
          variant="text"
          :disabled="busy || Object.values(shopping.busy.value).some(Boolean)"
          data-retry
          @click="page.act(() => shopping.retry(command.input.requestId), false)"
        >
          恢复原请求
        </HomeAction>
      </view>
      <view
        v-if="busy"
        class="shopping-hint"
      >
        正在读取…
      </view>
      <template v-if="selected">
        <view class="shopping-current">
          <HomeAction
            :label="'切换清单，当前为' + selected.name"
            appearance="text"
            variant="text"
            data-switch-list
            @click="choosing = true"
          >
            {{ selected.name }} ▾
          </HomeAction>
          <HomeAction
            :label="'管理清单' + selected.name"
            variant="text"
            data-manage-list
            @click="editList"
          >
            管理
          </HomeAction>
        </view>
        <text class="shopping-hint">
          {{ itemsCursor ? '当前已加载' : '共' }} {{ items.length }} 项，已购 {{ items.filter(row => row.checked).length }} 项
        </text>
        <view
          v-if="!items.length && !busy"
          class="shopping-empty"
        >
          <text class="shopping-section-title">
            还没有采购条目
          </text><text>把需要买的东西记在这里，家人都能看到。</text>
        </view>
        <view
          v-else-if="items.length && !itemsCursor && items.every(row => row.checked)"
          class="shopping-complete"
        >
          这一单，都备齐了。已购条目仍可取消勾选。
        </view>
        <view
          v-for="group in groups"
          :key="group.title"
          class="shopping-group"
        >
          <text
            v-if="group.rows.length"
            class="shopping-section-title"
          >
            {{ group.title }}
          </text>
          <view
            v-for="row in group.rows"
            :key="row.id"
            class="shopping-row"
            :class="{ 'shopping-row--checked': row.checked }"
            data-shopping-row
          >
            <!-- Wot 2.4.0 uses plain views; one native semantic target owns this continuous hit area. -->
            <view
              class="shopping-check"
              role="checkbox"
              aria-role="checkbox"
              :aria-label="(row.checked ? '取消已购' : '标记已购') + (row.name || row.raw)"
              :aria-checked="row.checked"
              :aria-disabled="rowBusy(row) || !!pendingFor(row)"
              :aria-busy="rowBusy(row)"
              :tabindex="rowBusy(row) || pendingFor(row) ? -1 : 0"
              data-check-item
              @click="check(row)"
              @keydown.enter.prevent="check(row)"
              @keydown.space.prevent="check(row)"
            >
              <view
                class="shopping-checkbox-visual"
                aria-hidden="true"
                inert
              >
                <wd-checkbox
                  :model-value="row.checked"
                  type="square"
                  readonly
                  :disabled="rowBusy(row) || !!pendingFor(row)"
                />
              </view>
              <view class="shopping-item-copy">
                <text class="shopping-item-name">
                  {{ row.name || row.raw }}
                </text><text
                  v-if="row.name && row.raw !== row.name"
                  class="shopping-hint"
                >
                  {{ row.raw }}
                </text><text
                  v-if="row.note"
                  class="shopping-hint"
                >
                  {{ row.note }}
                </text><text
                  v-if="rowBusy(row)"
                  class="shopping-hint"
                >
                  正在确认…
                </text>
              </view>
              <text class="shopping-amount">
                {{ amount(row) }}
              </text>
            </view>
            <HomeAction
              :label="'编辑' + (row.name || row.raw)"
              variant="text"
              :disabled="rowBusy(row) || !!pendingFor(row)"
              data-edit-item
              @click="editItem(row)"
            >
              编辑
            </HomeAction>
          </view>
        </view>
        <HomeAction
          v-if="itemsCursor"
          label="加载更多条目"
          variant="text"
          :disabled="busy"
          data-more-items
          @click="page.act(() => shopping.listItems(true))"
        >
          加载更多条目
        </HomeAction>
        <HomeAction
          label="添加采购条目"
          type="primary"
          block
          data-add-item
          @click="editItem()"
        >
          再加一件
        </HomeAction>
        <text class="shopping-footer">
          这份清单由家人一起维护。买好一件，轻点一下。
        </text>
      </template>
      <view
        v-else-if="!busy"
        class="shopping-empty"
      >
        <text class="shopping-section-title">
          {{ lists.length ? '选择一张购物清单' : '还没有购物清单' }}
        </text><text>可以为每次采购建立不同清单，家人共同维护。</text>
        <HomeAction
          v-if="lists.length"
          label="选择清单"
          type="primary"
          @click="choosing = true"
        >
          选择清单
        </HomeAction><HomeAction
          v-else
          label="创建第一张清单"
          type="primary"
          @click="addList"
        >
          创建清单
        </HomeAction>
      </view>
      <wd-popup
        v-model="choosing"
        position="bottom"
        safe-area-inset-bottom
        closable
      >
        <view class="shopping-picker">
          <text class="shopping-section-title">
            选择购物清单
          </text><wd-cell-group border>
            <view
              v-for="list in lists"
              :key="list.id"
              class="shopping-list-choice"
              role="button"
              aria-role="button"
              :aria-label="list.name + (list.id === selectedId ? '，当前清单' : '')"
              tabindex="0"
              @click="choose(list.id)"
              @keydown.enter.prevent="choose(list.id)"
            >
              <view
                aria-hidden="true"
                inert
              >
                <wd-cell
                  :title="list.name"
                  :value="list.id === selectedId ? '当前' : ''"
                  is-link
                />
              </view>
            </view>
          </wd-cell-group><HomeAction
            v-if="listsCursor"
            label="加载更多清单"
            variant="text"
            @click="page.act(() => shopping.listLists(true))"
          >
            加载更多清单
          </HomeAction><HomeAction
            label="新建清单"
            variant="text"
            @click="addList"
          >
            新建清单
          </HomeAction>
        </view>
      </wd-popup>
    </template>
  </view>
</template>
<style src="../../features/shopping/shopping.css" />
