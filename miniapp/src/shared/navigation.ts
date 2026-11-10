export function resetPage(url: string) {
  if (url === '/pages/recipes/index' || url === '/pages/family/home') uni.switchTab({ url });
  else uni.reLaunch({ url });
}

export function backPage(tab: '/pages/recipes/index' | '/pages/family/home') {
  const fallback = () => uni.switchTab({ url: tab });
  if (getCurrentPages().length > 1) uni.navigateBack({ fail: fallback });
  else fallback();
}
