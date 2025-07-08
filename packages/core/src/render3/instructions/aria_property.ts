/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */
import {bindingUpdated} from '../bindings';
import {RENDERER} from '../interfaces/view';
import {getLView, getSelectedTNode, getTView, nextBindingIndex} from '../state';
import {setAriaAttributeAndInputs, storePropertyBindingMetadata} from './shared';

/**
 * Update an ARIA attribute by either its attribute or property name on a selected element.
 *
 * If the property name also exists as an input property on any of the element's directives, those
 * inputs will be set instead of the element property.
 *
 * @param name Name of the ARIA attribute or property (beginning with `aria`).
 * @param value New value to write.
 * @returns This function returns itself so that it may be chained.
 *
 * @codeGenApi
 */
export function ɵɵariaProperty<T>(name: string, value: T): typeof ɵɵariaProperty {
  const lView = getLView();
  const bindingIndex = nextBindingIndex();
  if (bindingUpdated(lView, bindingIndex, value)) {
    const tView = getTView();
    const tNode = getSelectedTNode();
    setAriaAttributeAndInputs(tNode, lView, name, value, lView[RENDERER]);
    ngDevMode && storePropertyBindingMetadata(tView.data, tNode, name, bindingIndex);
  }
  return ɵɵariaProperty;
}
