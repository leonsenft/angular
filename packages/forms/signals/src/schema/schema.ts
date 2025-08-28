/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {FieldPath, SchemaFn, SchemaOrSchemaFn} from '../api/types';
import {FieldPathNode} from './path_node';

/**
 * Keeps track of the path node for the schema function that is currently being compiled. This is
 * used to detect erroneous references to a path node outside of the context of its schema function.
 * Do not set this directly, it is a context variable managed by `SchemaImpl.compile`.
 */
let currentCompilingNode: FieldPathNode<unknown> | undefined = undefined;

/**
 * A cache of all schemas compiled under the current root compilation. This is used to avoid doing
 * extra work when compiling a schema that reuses references to the same sub-schema. For example:
 *
 * ```
 * const sub = schema(p => ...);
 * const s = schema(p => {
 *   apply(p.a, sub);
 *   apply(p.b, sub);
 * });
 * ```
 *
 * This also ensures that we don't go into an infinite loop when compiling a schema that references
 * itself.
 *
 * Do not directly add or remove entries from this map, it is a context variable managed by
 * `SchemaImpl.compile` and `SchemaImpl.rootCompile`.
 */
const compiledSchemas = new Map<SchemaImpl<unknown>, FieldPathNode<unknown>>();

/**
 * Implements the `Schema` concept.
 */
export class SchemaImpl<TValue> {
  constructor(private schemaFn: SchemaFn<TValue>) {}

  /**
   * Compiles this schema within the current root compilation context. If the schema was previously
   * compiled within this context, we reuse the cached FieldPathNode, otherwise we create a new one
   * and cache it in the compilation context.
   */
  compile(): FieldPathNode<TValue> {
    const key = this as SchemaImpl<unknown>;
    if (compiledSchemas.has(key)) {
      return compiledSchemas.get(key) as FieldPathNode<TValue>;
    }
    const path = FieldPathNode.newRoot<TValue>();
    compiledSchemas.set(key, path as FieldPathNode<unknown>);
    let prevCompilingNode = currentCompilingNode;
    try {
      currentCompilingNode = path as FieldPathNode<unknown>;
      this.schemaFn(path.fieldPathProxy);
    } finally {
      // Use a try/finally to ensure we restore the previous root upon completion,
      // even if there are errors while compiling the schema.
      currentCompilingNode = prevCompilingNode;
    }
    return path;
  }

  /**
   * Creates a SchemaImpl from the given SchemaOrSchemaFn.
   */
  static create<TValue>(schema: SchemaImpl<TValue> | SchemaOrSchemaFn<TValue>) {
    if (schema instanceof SchemaImpl) {
      return schema;
    }
    return new SchemaImpl(schema as SchemaFn<TValue>);
  }

  /**
   * Compiles the given schema in a fresh compilation context. This clears the cached results of any
   * previous compilations.
   */
  static rootCompile<TValue>(
    schema: SchemaImpl<TValue> | SchemaOrSchemaFn<TValue> | undefined,
  ): FieldPathNode<TValue> {
    try {
      compiledSchemas.clear();
      if (schema === undefined) {
        return FieldPathNode.newRoot();
      }
      if (schema instanceof SchemaImpl) {
        return schema.compile();
      }
      return new SchemaImpl(schema as SchemaFn<TValue>).compile();
    } finally {
      // Use a try/finally to ensure we properly reset the compilation context upon completion,
      // even if there are errors while compiling the schema.
      compiledSchemas.clear();
    }
  }
}

/** Checks if the given value is a schema or schema function. */
export function isSchemaOrSchemaFn(value: unknown): value is SchemaOrSchemaFn<unknown> {
  return value instanceof SchemaImpl || typeof value === 'function';
}

/** Checks that a path node belongs to the schema function currently being compiled. */
export function assertPathIsCurrent(path: FieldPath<unknown>): void {
  if (currentCompilingNode !== FieldPathNode.unwrapFieldPath(path).root) {
    throw new Error(
      `A FieldPath can only be used directly within the Schema that owns it,` +
        ` **not** outside of it or within a sub-schema.`,
    );
  }
}
