<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app';
import { useAppClient } from './shared/app-client';
const { auth } = useAppClient();
onLaunch(() => { void auth.restore(); });
onShow(() => { void auth.restore(); });
</script>
<style>
page { background: #f6f5ef; color: #233529; }
button { background: #216840; color: #fff; border-radius: 20rpx; }
</style>
