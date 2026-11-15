export function enterPage(url: string) {
  if (url === '/pages/recipes/index' || url === '/pages/family/home' || url === '/pages/planning/index') uni.switchTab({ url });
  else uni.reLaunch({ url });
}
