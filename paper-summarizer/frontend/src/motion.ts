/** 動きを減らす設定のときは、スクロールのアニメーションをしない */
export const scrollBehavior = (): ScrollBehavior => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')
