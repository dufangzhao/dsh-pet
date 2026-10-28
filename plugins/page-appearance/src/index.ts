import { definePlugin } from '@pet/plugin-sdk';
export default definePlugin({
  activate(context) {
    context.contribute('page');
  },
});
