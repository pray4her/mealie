// Limit registration to the official component types used by this client.
declare module 'vue' {
  export interface GlobalComponents {
    WdForm: typeof import('@wot-ui/ui/components/wd-form/wd-form.vue')['default'];
    WdFormItem: typeof import('@wot-ui/ui/components/wd-form-item/wd-form-item.vue')['default'];
    WdButton: typeof import('@wot-ui/ui/components/wd-button/wd-button.vue')['default'];
    WdPopup: typeof import('@wot-ui/ui/components/wd-popup/wd-popup.vue')['default'];
    WdCell: typeof import('@wot-ui/ui/components/wd-cell/wd-cell.vue')['default'];
    WdCellGroup: typeof import('@wot-ui/ui/components/wd-cell-group/wd-cell-group.vue')['default'];
  }
}
export {};
