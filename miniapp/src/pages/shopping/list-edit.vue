<script setup lang="ts">
import WdForm from '@wot-ui/ui/components/wd-form/wd-form.vue';
import WdFormItem from '@wot-ui/ui/components/wd-form-item/wd-form-item.vue';
import HomeAction from '../../components/HomeAction.vue';
import { usePageTypography } from '../../shared/use-page-typography';
import { useShoppingEditor } from '../../features/shopping/use-shopping-editor';
const { rootFontSize } = usePageTypography();
const { page, draft, form, fields, schema, definitions, targetId, ready, committed, locked, original, save, remove, retry, reload, back, change, validateField } = useShoppingEditor('list');
const { confirmed, message, busy } = page;
</script>
<template>
  <page-meta :root-font-size="rootFontSize" />
  <view class="page shopping-page">
    <template v-if="confirmed">
      <text class="shopping-kicker">
        家人共享的采购安排
      </text><text class="shopping-title">
        {{ targetId ? '管理清单' : '新建清单' }}
      </text>
      <view
        v-if="message"
        class="shopping-status"
        data-message
      >
        <text>{{ message }}</text>
      </view>
      <view
        v-if="committed"
        class="shopping-status"
        data-committed
      >
        <text>{{ committed === 'removed' ? '已删除' : '已保存' }}</text><text v-if="page.shopping.readError.value">
          操作已确认，返回清单后可重试读取最新内容。
        </text><HomeAction
          label="返回购物清单"
          type="primary"
          data-back
          @click="back"
        >
          返回清单
        </HomeAction>
      </view>
      <template v-else>
        <view
          v-if="original"
          class="shopping-status"
          data-pending
        >
          <text>原请求结果尚未确认，请恢复原操作。</text><HomeAction
            label="恢复原请求"
            :disabled="busy"
            data-retry
            @click="retry"
          >
            恢复原请求
          </HomeAction>
        </view>
        <wd-form
          v-if="ready"
          ref="form"
          :model="draft"
          :schema="schema"
        >
          <view
            v-for="field in definitions"
            :key="field.key"
            class="shopping-field"
          >
            <wd-form-item
              :prop="field.key"
              :title="field.label"
              :required="field.required"
            >
              <text class="shopping-label">
                {{ field.label }}{{ field.required ? '（必填）' : '' }}
              </text>
              <textarea
                v-if="field.multiline"
                :id="field.key"
                class="home-input shopping-textarea"
                :value="draft[field.key]"
                :data-field="field.key"
                :maxlength="field.max"
                :disabled="locked"
                :aria-label="field.label"
                :aria-invalid="!!fields.errors[field.key]"
                :aria-describedby="fields.errors[field.key] ? field.key + '-error' : undefined"
                :focus="fields.focused === field.key"
                @input="change(field.key, $event.detail.value)"
                @blur="validateField(field.key)"
              />
              <input
                v-else
                :id="field.key"
                class="home-input shopping-input"
                :type="field.key === 'quantity' ? 'digit' : 'text'"
                :value="draft[field.key]"
                :data-field="field.key"
                :maxlength="field.max"
                :disabled="locked"
                :aria-label="field.label"
                :aria-invalid="!!fields.errors[field.key]"
                :aria-describedby="fields.errors[field.key] ? field.key + '-error' : undefined"
                :focus="fields.focused === field.key"
                @input="change(field.key, $event.detail.value)"
                @blur="validateField(field.key)"
              >
              <text
                v-if="fields.errors[field.key]"
                :id="field.key + '-error'"
                class="field-error"
                data-field-error
              >
                {{ fields.errors[field.key] }}
              </text>
            </wd-form-item>
          </view>
        </wd-form>
        <view
          v-if="ready"
          class="shopping-actions"
        >
          <HomeAction
            label="保存清单"
            type="primary"
            block
            :disabled="locked"
            :loading="!!page.shopping.busy.value['list:' + (targetId || 'new')]"
            data-save
            @click="save"
          >
            保存清单
          </HomeAction>
          <HomeAction
            v-if="targetId"
            label="删除整张清单"
            type="danger"
            variant="text"
            :disabled="locked"
            data-remove
            @click="remove"
          >
            删除整张清单
          </HomeAction>
        </view>
        <HomeAction
          v-if="!original"
          label="重新加载当前内容"
          variant="text"
          :disabled="busy"
          data-reload
          @click="reload"
        >
          重新加载
        </HomeAction><HomeAction
          label="返回购物清单"
          variant="text"
          :disabled="busy"
          data-back
          @click="back"
        >
          返回清单
        </HomeAction>
      </template>
    </template>
    <view
      v-else
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
  </view>
</template>
<style src="../../features/shopping/shopping.css" />
