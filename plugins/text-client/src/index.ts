import { definePlugin } from '@pet/plugin-sdk';

/**
 * 文字客户端的 runtime 部分。
 *
 * 页面本身是静态资产（dist/index.html + client.js + client.css），由服务在插件
 * 启用时托管；这里只登记 panel 贡献，不持有任何业务状态。
 */
export default definePlugin({
  activate(context) {
    context.contribute('text-client');
  },
});
