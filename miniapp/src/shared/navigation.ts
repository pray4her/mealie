export function enterPage(url: string) {
  if (url === '/pages/recipes/index' || url === '/pages/family/home' || url === '/pages/planning/index' || url === '/pages/shopping/index') uni.switchTab({ url });
  else uni.reLaunch({ url });
}
