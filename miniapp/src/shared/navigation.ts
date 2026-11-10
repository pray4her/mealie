export function enterPage(url: string) {
  if (url === '/pages/recipes/index' || url === '/pages/family/home') uni.switchTab({ url });
  else uni.reLaunch({ url });
}
