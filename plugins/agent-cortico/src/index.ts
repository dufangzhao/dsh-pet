import { definePlugin } from '@pet/plugin-sdk';
import { activateAgent } from './agent.mjs';
export default definePlugin({ activate: activateAgent });
