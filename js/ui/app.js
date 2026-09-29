// Entry point for index.html.
import { start, hooks } from './main.js';
import { installTips } from './tipsPanel.js';

installTips(hooks);
start();
