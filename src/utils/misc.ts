import {
  CompiledTypeName, GQLScalarCompiledTypesMap, GQLScalarType, DisplayType,
  GraphQLNonWrappedType, DefinitionWithImportTypes,
} from '../types';
import {
  GraphQLField,
  GraphQLFieldConfig, GraphQLInputType,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLSchema,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isWrappingType,
  OperationTypeNode,
  TypeNode,
} from 'graphql';
import {getFileName} from '../fs';

// Defines which GQL type converts to which TypeScript type
const gqlScalarTypesMap: GQLScalarCompiledTypesMap = {
  Boolean: 'boolean',
  Float: 'number',
  String: 'string',
  Int: 'number',
  ID: 'any',
};

/**
 * List of GQL scalar types
 * @type {GQLScalarType[]}
 */
const gqlScalarTypes = Object.keys(gqlScalarTypesMap) as GQLScalarType[];

/**
 * Returns string with "count" spaces count
 * @param {number} count
 * @returns {string}
 */
export function getSpaces(count: number): string {
  return new Array(count).fill(' ').join('');
}

/**
 * Returns text with spaces before
 * @param {string} text
 * @param spacesCount
 * @returns {string}
 */
export function withSpaces(text: string, spacesCount: number): string {
  const spaces = getSpaces(spacesCount);

  return text
    .split('\n')
    .map(p => p.length === 0 ? p : spaces + p)
    .join('\n');
}

/**
 * Returns formatted TS description
 * @param {string} description
 * @param {number} spacesCount
 * @returns {string}
 */
export function formatDescription(
  description: string | undefined,
  spacesCount: number = 0,
): string {
  if (!description) {
    return '';
  }

  return withSpaces(`/**\n * ${description}\n */`, spacesCount) + '\n';
}

/**
 * States if value is GQL scalar type
 * @param value
 * @returns {value is GQLScalarType}
 */
export function isGQLScalarType(value: string): value is GQLScalarType {
  return gqlScalarTypes.includes(value as any);
}

/**
 * Converts GQL type name to TS type name. Keeps custom compiled names
 * @param {string} value
 * @returns {string}
 */
export function transpileGQLTypeName(value: string): CompiledTypeName {
  return isGQLScalarType(value) ? gqlScalarTypesMap[value] : value;
}

/**
 * Makes type nullable
 * @returns {string}
 * @param type
 */
export function makeNullable(type: string): string {
  return `${type} | null`;
}

/**
 * Recursively gets type definition getting deeper into types tree
 * @param {TypeNode} node
 * @param importTypes
 * @param {boolean} nullable
 * @returns {string}
 */
export function getTypeNodeDefinition(
  node: TypeNode,
  importTypes: string[] = [],
  nullable = true,
): DefinitionWithImportTypes {
  switch (node.kind) {
    case 'NonNullType':
      return getTypeNodeDefinition(node.type, importTypes, false);
    case 'NamedType':
    case 'ListType':
      let definition = '';

      if (node.kind === 'NamedType') {
        const name = node.name.value;
        definition = transpileGQLTypeName(name);

        if (!isGQLScalarType(name) && !importTypes.includes(name)) {
          importTypes.push(name);
        }
      } else {
        const {
          importTypes: _importTypes, definition: _definition,
        } = getTypeNodeDefinition(node.type, importTypes, true);

        _importTypes.forEach(t => {
          if (!isGQLScalarType(t) && !importTypes.includes(t)) {
            importTypes.push(t);
          }
        });
        definition = `${_definition}[]`;
      }

      if (nullable) {
        definition = makeNullable(definition);
      }

      return {definition, importTypes};
  }
}

/**
 * Recursively gets type definition getting deeper into types tree
 * @param {GraphQLOutputType} type
 * @param importTypes
 * @param {boolean} nullable
 * @returns {string}
 */
export function getIOTypeDefinition(
  type: GraphQLOutputType | GraphQLInputType,
  importTypes: string[] = [],
  nullable = true,
): DefinitionWithImportTypes {
  if (isNonNullType(type)) {
    return getIOTypeDefinition(type.ofType, importTypes, false);
  }
  let definition = '';

  if (isListType(type)) {
    const {
      importTypes: _importTypes, definition: _definition,
    } = getIOTypeDefinition(type.ofType, importTypes, true);

    _importTypes.forEach(t => {
      if (!isGQLScalarType(t) && !importTypes.includes(t)) {
        importTypes.push(t);
      }
    });
    definition = `${_definition}[]`;
  } else {
    const {name} = type;
    definition = transpileGQLTypeName(name);

    if (!isGQLScalarType(name) && !importTypes.includes(name)) {
      importTypes.push(name);
    }
  }

  if (nullable) {
    definition = makeNullable(definition);
  }

  return {definition, importTypes};
}

/**
 * Returns sorter depending on display type
 * @param {DisplayType} display
 * @returns {(a: GraphQLNamedType, b: GraphQLNamedType) => (number | number)}
 */
export function getSorter(display: DisplayType) {
  const weights = {
    ScalarTypeDefinition: 0,
    EnumTypeDefinition: 1,
    InterfaceTypeDefinition: 2,
    InputObjectTypeDefinition: 3,
    UnionTypeDefinition: 4,
    ObjectTypeDefinition: 5,
  };

  return (a: GraphQLNamedType, b: GraphQLNamedType) => {
    if (a.astNode || b.astNode) {
      if (!a.astNode) {
        return -1;
      }
      if (!b.astNode) {
        return 1;
      }
      return display === 'as-is'
        ? a.astNode.loc.start - b.astNode.loc.start
        : weights[a.astNode.kind] - weights[b.astNode.kind];
    }
    return 0;
  }
}

/**
 * Converts text to camel case
 * @param {string} text
 * @returns {string}
 */
export function toCamelCase(text: string): string {
  const cleared = text.replace(/[^\da-z].?/gi, match => {
    return match[1] ? match[1].toUpperCase() : '';
  });
  return cleared[0].toUpperCase() + cleared.slice(1);
}

/**
 * Returns compiled operation name
 * @param {string} name
 * @param {string} operation
 * @returns {string}
 */
export function getCompiledOperationName(
  name: string,
  operation: string,
): string {
  return name + toCamelCase(operation);
}

/**
 * Returns compiled operation namespace name
 * @param {string} name
 * @param {string} operation
 * @returns {string}
 */
export function getCompiledOperationNamespaceName(
  name: string,
  operation: string,
): string {
  return toCamelCase(name) + toCamelCase(operation);
}

/**
 * Returns met list and non-nullable wrappers
 * @param {GraphQLOutputType} type
 * @param definition
 * @param nullable
 * @returns {string}
 */
export function getOutputTypeDefinitionWithWrappers(
  type: GraphQLOutputType,
  definition: string,
  nullable = true,
): string {
  if (isNonNullType(type)) {
    return getOutputTypeDefinitionWithWrappers(type.ofType, definition, false);
  }
  let def = definition;

  if (isListType(type)) {
    def = `${def}[]`;
  }

  return nullable ? makeNullable(def) : def;
}

/**
 * Returns operation root node depending on operation type
 * @param {GraphQLSchema} schema
 * @param {OperationTypeNode} operation
 * @returns {GraphQLObjectType}
 */
export function getOperationRootNode(
  schema: GraphQLSchema,
  operation: OperationTypeNode,
): GraphQLObjectType {
  if (operation === 'query') {
    return schema.getQueryType();
  } else if (operation === 'mutation') {
    return schema.getMutationType();
  }
  return schema.getSubscriptionType();
}

/**
 * Returns first met non wrapping GQL type
 * @param {GraphQLOutputType} type
 * @returns {GraphQLNonWrappedType}
 */
export function getFirstNonWrappingType(
  type: GraphQLOutputType,
): GraphQLNonWrappedType {
  return isWrappingType(type) ? getFirstNonWrappingType(type.ofType) : type;
}

/**
 * Gets field type depending on passed path
 * @param rootNode
 * @param {string} path
 * @returns {CompiledTypeName}
 */
export function getIn(
  rootNode: GraphQLObjectType,
  path: string,
): GraphQLField<any, any> | GraphQLFieldConfig<any, any> {
  const [firstPartial, ...restPartials] = path.split('.');
  const config = rootNode.toConfig();
  let field: GraphQLField<any, any> | GraphQLFieldConfig<any, any> =
    config.fields[firstPartial];

  if (!field) {
    throw new Error(`Unable to find path ${path}`);
  }
  if (restPartials.length === 0) {
    return field;
  }

  for (let i = 0; i < restPartials.length; i++) {
    const partial = restPartials[i];

    // Avoid lists and non nulls. We dont care about them
    const type = getFirstNonWrappingType(field.type);

    if (!isObjectType(type) && !isInterfaceType(type)) {
      throw new Error(`Unable to find path ${path}`);
    }
    field = type.getFields()[partial];

    if (!field) {
      throw new Error(`Unable to find path ${path}`);
    }

    // It this partial is the last in path, we have to return type of field
    if (i === restPartials.length - 1) {
      return field;
    }
  }
}

/**
 * Formats imports for custom types
 * @param {string[]} types
 * @param schemaFileName
 * @returns {string}
 */
export function formatImportTypes(types: string[], schemaFileName: string) {
  const schemaName = getFileName(schemaFileName);
  return types.length === 0
    ? ''
    : `import { ${types.join(', ')} } from './${schemaName}';\n\n`;
}
