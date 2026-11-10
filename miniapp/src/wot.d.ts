// Wot 2.4.0's full global entry checks unused canvas/media components against incompatible uni-helper events.
declare module 'vue' {
  export interface GlobalComponents {
    WdInput: typeof import('@wot-ui/ui/components/wd-input/wd-input.vue')['default'];
    WdTextarea: typeof import('@wot-ui/ui/components/wd-textarea/wd-textarea.vue')['default'];
    WdActionSheet: typeof import('@wot-ui/ui/components/wd-action-sheet/wd-action-sheet.vue')['default'];
    WdButton: typeof import('@wot-ui/ui/components/wd-button/wd-button.vue')['default'];
  }
}

export {};
