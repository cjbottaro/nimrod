import { defineToolPlugin, rawToolPresentation } from '../../card-plugin-ui';

/** Composition (children/progress) belongs to core; the plugin owns parent content. */
export default defineToolPlugin('nimrod.codemode', ['codemode'], data => ({
  ...rawToolPresentation(data), title: 'Codemode',
  inputDisclosure: { label: 'Script', field: 'code' }, outputDisclosure: 'Output',
}));
