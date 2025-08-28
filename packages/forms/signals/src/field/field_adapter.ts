/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {PathKind} from '../api/types';
import {FieldPathNode} from '../schema/path_node';

import {FormFieldManager} from './manager';
import {FieldNode} from './node';
import {FieldNodeState} from './state';
import {ChildFieldNodeOptions, FieldNodeOptions, FieldNodeStructure} from './structure';
import {ValidationState, FieldValidationState} from './validation';
import {WritableSignal} from '@angular/core';

/**
 * Adapter allowing customization of the creation logic for a field and its associated
 * structure and state.
 */
export interface FieldAdapter {
  /**
   * Creates a node structure.
   * @param node
   * @param options
   */
  createStructure<TValue>(
    node: FieldNode<TValue>,
    options: FieldNodeOptions<TValue>,
  ): FieldNodeStructure<TValue>;

  /**
   * Creates node validation state
   * @param param
   */
  createValidationState(param: FieldNode<unknown>): ValidationState;

  /**
   * Creates node state.
   * @param param
   */
  createNodeState(param: FieldNode<unknown>): FieldNodeState;

  /**
   * Creates a custom child node.
   * @param options
   */
  newChild<TValue>(options: ChildFieldNodeOptions<TValue>): FieldNode<TValue, PathKind.Child>;

  /**
   * Creates a custom root node.
   * @param fieldManager
   * @param model
   * @param pathNode
   * @param adapter
   */
  newRoot<TValue>(
    fieldManager: FormFieldManager,
    model: WritableSignal<TValue>,
    pathNode: FieldPathNode<TValue>,
    adapter: FieldAdapter,
  ): FieldNode<TValue>;
}

/**
 * Basic adapter supporting standard form behavior.
 */
export class BasicFieldAdapter implements FieldAdapter {
  /**
   * Creates a new Root field node.
   * @param fieldManager
   * @param value
   * @param pathNode
   * @param adapter
   */
  newRoot<TValue>(
    fieldManager: FormFieldManager,
    value: WritableSignal<TValue>,
    pathNode: FieldPathNode<TValue>,
    adapter: FieldAdapter,
  ): FieldNode<TValue> {
    return new FieldNode({
      kind: 'root',
      fieldManager,
      value,
      pathNode,
      logic: pathNode.logic.build(),
      fieldAdapter: adapter,
    });
  }

  /**
   * Creates a new child field node.
   * @param options
   */
  newChild<TValue>(options: ChildFieldNodeOptions<TValue>): FieldNode<TValue> {
    return new FieldNode(options);
  }

  /**
   * Creates a node state.
   * @param node
   */
  createNodeState(node: FieldNode<unknown>): FieldNodeState {
    return new FieldNodeState(node);
  }

  /**
   * Creates a validation state.
   * @param node
   */
  createValidationState(node: FieldNode<unknown>): ValidationState {
    return new FieldValidationState(node);
  }

  /**
   * Creates a node structure.
   * @param node
   * @param options
   */
  createStructure<TValue>(
    node: FieldNode<TValue>,
    options: FieldNodeOptions<TValue>,
  ): FieldNodeStructure<TValue> {
    return node.createStructure(options);
  }
}
