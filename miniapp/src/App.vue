<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app';
import { useAppClient } from './shared/app-client';
const { auth } = useAppClient();
onLaunch(() => { void auth.restore(); });
onShow(() => { void auth.restore(); });
</script>
<style>
@import './styles/theme.css';
</style>
