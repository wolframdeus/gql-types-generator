import {
  Enum,
  EnumValue,
  Scalar,
  Union,
  Entity,
  PreparedObject,
  Operation,
  PreparedObjectField,
  OperationNamespaceField, OperationRootNamespace, NamedGQLType,
} from '../types';
import {
  FieldNode,
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLUnionType,
  isEnumType,
  isInterfaceType,
  isObjectType,
  isScalarType,
  isUnionType,
  OperationDefinitionNode,
  SelectionSetNode,
  VariableDefinitionNode,
} from 'graphql';
import {
  getCompiledOperationName, getCompiledOperationNamespaceName,
  getIn, getIOTypeDefinition,
  getOperationRootNode,
  getTypeNodeDefinition,
  toCamelCase,
  transpileGQLTypeName,
} from './misc';

/**
 * Universal GraphQLNamedType parser. Skips GraphQL internal types like Boolean,
 * Int, Float and other
 * @returns {NamedGQLType}
 * @param type
 */
export function parseNamedType(type: GraphQLNamedType): NamedGQLType | null {
  if (!type.astNode) {
    return null;
  } else if (isScalarType(type)) {
    return parseScalarType(type);
  } else if (isUnionType(type)) {
    return parseUnionType(type);
  } else if (isEnumType(type)) {
    return parseEnumType(type);
  } else if (isObjectType(type) || isInterfaceType(type)) {
    return parseObjectOrInterfaceType(type);
  }
  return parseInputObjectType(type);
}

/**
 * Parses GraphQLEnumType
 * @returns {Enum}
 * @param type
 */
export function parseEnumType(type: GraphQLEnumType): Enum {
  const {description, name} = type;

  return {
    __type: 'enum',
    name,
    description,
    values: type.getValues().map<EnumValue>(({description, name}) => ({
      description,
      name,
    })),
  };
}

/**
 * Parses GraphQLInterfaceType and GraphQLObjectType
 * @returns {Entity}
 * @param type
 */
export function parseObjectOrInterfaceType(
  type: GraphQLInterfaceType | GraphQLObjectType,
): Entity {
  const {description, name} = type;
  const fields = type.getFields();
  const formattedName = toCamelCase(name);

  return Object.values(fields).reduce<Entity>((acc, f) => {
    const {name: fieldName, type, description: fieldDescription, args} = f;

    // Fields
    acc.fields.fields.push({
      name: fieldName,
      description: fieldDescription,
      type: `${formattedName}.${fieldName}`,
    });

    // Arguments
    const preparedArguments = args.reduce<PreparedObject>((argAcc, arg) => {
      const {type, name, description} = arg;
      const {definition, importTypes} = getIOTypeDefinition(type);

      argAcc.fields.push({
        name,
        description,
        type: definition,
      });

      importTypes.forEach(t => {
        if (!argAcc.importTypes.includes(t)) {
          argAcc.importTypes.push(t);
        }
      });

      return argAcc;
    }, {
      name: 'Arguments',
      fields: [],
      importTypes: [],
    });

    // Namespace
    const {definition, importTypes: fImportTypes} = getIOTypeDefinition(type);

    // Add all collected required types
    [...fImportTypes, ...preparedArguments.importTypes].forEach(t => {
      if (!acc.importTypes.includes(t)) {
        acc.importTypes.push(t);
      }
    });

    acc.namespace.fields.push({
      name: fieldName,
      description: fieldDescription,
      args: preparedArguments,
      type: definition,
    });

    return acc;
  }, {
    __type: 'entity',
    fields: {
      name: formattedName,
      fields: [],
    },
    namespace: {
      name: formattedName,
      description,
      fields: [],
    },
    importTypes: [],
  });
}

/**
 * Parses GraphQLInputObjectType
 * @param {GraphQLInputObjectType} type
 * @returns {Entity}
 */
export function parseInputObjectType(type: GraphQLInputObjectType): Entity {
  const {description, name} = type;
  const fields = type.getFields();
  const formattedName = toCamelCase(name);

  return Object.values(fields).reduce<Entity>((acc, f) => {
    const {name: fieldName, type, description: fieldDescription} = f;

    // Fields
    acc.fields.fields.push({
      name: fieldName,
      description: fieldDescription,
      type: `${formattedName}.${fieldName}`,
    });

    // Namespace
    const {definition, importTypes: fImportTypes} = getIOTypeDefinition(type);

    // Add all collected required types
    fImportTypes.forEach(t => {
      if (!acc.importTypes.includes(t)) {
        acc.importTypes.push(t);
      }
    });

    acc.namespace.fields.push({
      name: fieldName,
      description: fieldDescription,
      args: null,
      type: definition,
    });

    return acc;
  }, {
    __type: 'entity',
    fields: {
      name: formattedName,
      fields: [],
    },
    namespace: {
      name: formattedName,
      description,
      fields: [],
    },
    importTypes: [],
  });
}

/**
 * Parses GraphQLScalarType
 * @returns {Scalar}
 * @param type
 */
export function parseScalarType(type: GraphQLScalarType): Scalar {
  const {name, description} = type;
  return {__type: 'scalar', description, name};
}

/**
 * Parses GraphQLUnionType
 * @returns {Union}
 * @param type
 */
export function parseUnionType(type: GraphQLUnionType): Union {
  const {name, description} = type;

  return {
    __type: 'union',
    name,
    description,
    types: type.getTypes().map(t => transpileGQLTypeName(t.name)),
  };
}

/**
 * Parses GQL operation variables
 * @param {VariableDefinitionNode[]} nodes
 * @returns {PreparedObject<true>}
 */
export function parseOperationVariableDefinitions(
  nodes: VariableDefinitionNode[],
): PreparedObject<true> {
  return nodes.reduce<PreparedObject<true>>((acc, n) => {
    const {variable, type} = n;
    const {definition, importTypes} = getTypeNodeDefinition(type);

    acc.fields.push({
      name: variable.name.value,
      type: definition,
    });

    importTypes.forEach(t => {
      if (!acc.importTypes.includes(t)) {
        acc.importTypes.push(t);
      }
    });

    return acc;
  }, {
    name: 'Arguments',
    fields: [],
    importTypes: [],
  });
}

/**
 * Gets selection's set required types and definition
 * @param {SelectionSetNode} selectionSet
 * @param nspName
 * @returns {string}
 */
export function selectionSetToObjectFields(
  selectionSet: SelectionSetNode,
  nspName: string,
): PreparedObjectField[] {
  return selectionSet.selections.reduce<PreparedObjectField[]>((acc, s) => {
    // TODO: Fragments support
    if (s.kind === 'Field') {
      const name = s.name.value;
      acc.push({
        name,
        type: `${nspName}.${name}`,
      });
    }
    return acc;
  }, [])
}

/**
 * Converts selection set to namespace fields
 * @param {SelectionSetNode} selectionSet
 * @param rootNode
 * @param path
 * @returns {OperationNamespaceField[]}
 */
export function selectionSetToNamespaceFields(
  selectionSet: SelectionSetNode,
  rootNode: GraphQLObjectType,
  path = '',
): OperationNamespaceField[] {
  return selectionSet.selections.reduce<OperationNamespaceField[]>((acc, s) => {
    // TODO: Fragments support
    if (s.kind === 'Field') {
      acc.push(fieldNodeToNamespaceField(s, rootNode, path));
    }
    return acc;
  }, []);
}

/**
 * Converts selection set to OperationRootNamespace
 * @param {SelectionSetNode} selectionSet
 * @param {string} compiledName
 * @param {PreparedObject} args
 * @param {GraphQLObjectType} rootNode
 * @returns {OperationRootNamespace}
 */
export function selectionSetToRootNamespace(
  selectionSet: SelectionSetNode,
  compiledName: string,
  args: PreparedObject,
  rootNode: GraphQLObjectType,
): OperationRootNamespace {
  const nspFields = selectionSetToNamespaceFields(selectionSet, rootNode);
  const importTypes = nspFields.flatMap(getImportTypes);

  return {
    name: compiledName,
    fields: nspFields,
    args,
    importTypes,
  };
}

/**
 * Recursively gets required types from operation namespace field
 * @param {OperationNamespaceField} field
 * @returns {string[]}
 */
export function getImportTypes(field: OperationNamespaceField): string[] {
  const types: string[] = [];

  function addType(type: string) {
    if (!types.includes(type)) {
      types.push(type);
    }
  }

  if (field.type.importTypes) {
    field.type.importTypes.forEach(addType);
  }
  if (field.fields) {
    field.fields.flatMap(getImportTypes).forEach(addType);
  }
  return types;
}

/**
 * Converts FieldNode to OperationNamespaceField
 * @param {FieldNode} node
 * @param {GraphQLObjectType} rootNode
 * @param {string} prevPath
 * @returns {OperationNamespaceField}
 */
export function fieldNodeToNamespaceField(
  node: FieldNode,
  rootNode: GraphQLObjectType,
  prevPath: string,
): OperationNamespaceField {
  const nodeName = node.name.value;
  const path = prevPath.length > 0 ? `${prevPath}.${nodeName}` : nodeName;
  const outputType = getIn(rootNode, path).type;

  if (node.selectionSet) {
    return {
      name: nodeName,
      type: {
        name: nodeName,
        fields: node.selectionSet.selections.reduce<PreparedObjectField[]>((acc, s) => {
          // TODO: Fragments support
          if (s.kind === 'Field') {
            const selectionName = s.name.value;
            acc.push({
              name: selectionName,
              type: `${nodeName}.${selectionName}`,
            });
          }
          return acc;
        }, []),
        outputType,
      },
      fields: selectionSetToNamespaceFields(node.selectionSet, rootNode, path),
    }
  }
  return {
    name: nodeName,
    type: getIOTypeDefinition(outputType),
  }
}

/**
 * Parses GQL operation
 * @param {OperationDefinitionNode} node
 * @param {GraphQLSchema} schema
 * @param operationsString
 * @returns {Operation}
 */
export function parseOperationDefinitionNode(
  node: OperationDefinitionNode,
  schema: GraphQLSchema,
  operationsString: string,
): Operation {
  const {name, selectionSet, operation, variableDefinitions, loc} = node;
  const operationName = getCompiledOperationName(name.value, operation);
  const operationNamespaceName =
    getCompiledOperationNamespaceName(name.value, operation);
  const rootNode = getOperationRootNode(schema, operation);
  const importTypes: string[] = [];

  const addImportTypes = (types: string[]) => types.forEach(t => {
    if (!importTypes.includes(t)) {
      importTypes.push(t);
    }
  });

  // Selection
  const selection: PreparedObject = {
    name: operationName,
    fields: selectionSetToObjectFields(selectionSet, operationNamespaceName),
  };

  // Arguments
  const args = parseOperationVariableDefinitions([...variableDefinitions]);
  addImportTypes(args.importTypes);

  // Namespace
  const namespace = selectionSetToRootNamespace(
    selectionSet, operationNamespaceName, args, rootNode,
  );
  addImportTypes(namespace.importTypes);

  return {
    __type: 'operation',
    name: operationName,
    signature: operationsString.slice(loc.start, loc.end),
    selection,
    namespace,
    importTypes,
  }
}
