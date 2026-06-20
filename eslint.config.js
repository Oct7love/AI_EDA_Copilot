// @ts-check
/**
 * ESLint flat config (ESLint 9 + typescript-eslint 8).
 *
 * 目标：发现真实问题（未用变量、不可达代码、空块、明显错误），
 * 不做大规模风格化。噪声型规则（no-explicit-any 等）降级为 warning，
 * 让 `npm run lint` 在当前代码库上可运行且不被既有合理用法拦住。
 */
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');
const globals = require('globals');

module.exports = tseslint.config(
  {
    ignores: ['dist/**', 'out/**', 'node_modules/**', '**/*.config.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // TS 负责未定义符号检查，关闭 ESLint 的 no-undef（typescript-eslint 官方建议）
      'no-undef': 'off',
      // 未用变量视为错误，但允许下划线前缀占位与 catch 形参
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // 项目存在少量有注释说明的 any（SDK 动态 body、JSON.parse 校验回调），降级为提示
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // 测试文件放宽 any（大量 fixture 强转）
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Webview React 侧：启用 hooks 规则
    files: ['src/webview/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
