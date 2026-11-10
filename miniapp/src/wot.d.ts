// Wot 2.4.0's full global entry checks unused canvas/media components against incompatible uni-helper events.
declare module 'vue' {
  export interface GlobalComponents {
    WdButton: typeof import('@wot-ui/ui/components/wd-button/wd-button.vue')['default'];
  }
}

export {};
