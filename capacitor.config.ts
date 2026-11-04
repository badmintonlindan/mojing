import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = { appId: 'cn.mojing.study', appName: '墨径', webDir: 'dist', loggingBehavior: 'none', server: { androidScheme: 'https' }, android: { allowMixedContent: false } };
export default config;
