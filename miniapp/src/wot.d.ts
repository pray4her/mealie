// Limit registration to the official component types used by this client.
declare module 'vue' {
  export interface GlobalComponents {
    WdButton: typeof import('@wot-ui/ui/components/wd-button/wd-button.vue')['default'];
    WdSearch: typeof import('@wot-ui/ui/components/wd-search/wd-search.vue')['default'];
    WdInput: typeof import('@wot-ui/ui/components/wd-input/wd-input.vue')['default'];
    WdTextarea: typeof import('@wot-ui/ui/components/wd-textarea/wd-textarea.vue')['default'];
    WdPopup: typeof import('@wot-ui/ui/components/wd-popup/wd-popup.vue')['default'];
  }
}
export {};
