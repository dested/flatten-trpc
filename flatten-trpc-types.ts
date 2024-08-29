import {Project, Symbol, SourceFile, Node, Type, TypeFormatFlags, SymbolFlags} from 'ts-morph';
import * as fs from 'node:fs';

const safeTypes = [
  {typeName: 'Date'},
  {typeName: 'boolean'},
  {typeName: 'string'},
  {typeName: 'number'},
  {typeName: 'bigint'},
  {typeName: 'symbol'},
  {typeName: 'undefined'},
  {typeName: 'Event'},
  {typeName: 'EventTarget'},
  {typeName: 'EventListener'},
  {typeName: 'AbortSignal'},
  {typeName: 'null'},
  {typeName: 'void'},
  {typeName: 'never'},
  {typeName: 'unknown'},
  {typeName: 'any'},
  {typeName: 'object'},
  {typeName: 'SharedArrayBuffer'},
  {typeName: 'ArrayBuffer'},
  {typeName: 'ArrayBufferView'},
];

const fuzzySafeTypes = [
  {typeName: 'ILayer'},
  {typeName: 'ProcedureOptions'},
  {typeName: 'Response<'},
  {typeName: 'PromiseLike<'},
];

function flattenType(type: Type, sourceFile: SourceFile, seenTypes: Map<string, string> = new Map()): string {
  const typeText = type.getText(
    undefined,
    TypeFormatFlags.NoTruncation |
      TypeFormatFlags.UseTypeOfFunction |
      TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
      TypeFormatFlags.WriteTypeArgumentsOfSignature |
      TypeFormatFlags.OmitParameterModifiers |
      TypeFormatFlags.UseFullyQualifiedType
  );

  /*  if (typeText.includes('AffordacareGroupStage')) {
    debugger;
  }*/

  // if its Date, just emit Date, dont introspect
  if (safeTypes.find((t) => t.typeName === typeText)) {
    return typeText;
  }

  if (fuzzySafeTypes.find((t) => typeText.startsWith(t.typeName))) {
    if (typeText.includes('ProcedureOptions')) {
      return 'ProcedureOptions';
    }
    return typeText;
  }

  // console.log('typeText:', typeText);

  if (seenTypes.has(typeText)) {
    if (seenTypes.get(typeText) !== '') {
      return seenTypes.get(typeText)!;
    } else {
      // todo support writing recursive type, return out a placeholder and then write that placeholder out
      console.log('recursive', typeText);
      return 'any';
    }
  }
  seenTypes.set(typeText, '');

  if (typeText.startsWith('Promise<')) {
    debugger;
    let result = `Promise<${flattenType(type.getTypeArguments()[0], sourceFile, seenTypes)}>`;
    seenTypes.set(typeText, result);
    return result;
  }
  if (typeText.startsWith('PromiseLike<')) {
    let result = `PromiseLike<${flattenType(type.getTypeArguments()[0], sourceFile, seenTypes)}>`;
    seenTypes.set(typeText, result);
    return result;
  }

  if (type.isUnion()) {
    let result = type
      .getUnionTypes()
      .map((t) => flattenType(t, sourceFile, seenTypes))
      .filter((t) => t)
      .join(' | ');
    seenTypes.set(typeText, result);
    return result;
  }

  if (type.isIntersection()) {
    let result = type
      .getIntersectionTypes()
      .map((t) => flattenType(t, sourceFile, seenTypes))
      .filter((t) => t)
      .join(' & ');
    seenTypes.set(typeText, result);
    return result;
  }
  if (type.getText().startsWith('[')) {
    const tupleTypes = type.getTypeArguments();
    let result = `[${tupleTypes.map((t) => flattenType(t, sourceFile, seenTypes)).join(', ')}]`;
    seenTypes.set(typeText, result);
    return result;
  }

  if (type.isArray()) {
    let result = `Array<${flattenType(type.getArrayElementType()!, sourceFile, seenTypes)}>`;
    seenTypes.set(typeText, result);
    return result;
  }

  if (type.isObject()) {
    if (type.getCallSignatures().length > 0) {
      // Handle function types
      const signatures = type.getCallSignatures();
      let result = signatures
        .map((sig) => {
          const params = sig
            .getParameters()
            .map((param) => {
              const paramType = param.getTypeAtLocation(sourceFile);
              const name = param.getName();
              const value = flattenType(paramType, sourceFile, seenTypes);
              // if its spread param, include it
              function isRestParameter(param: Symbol) {
                let a = param.getFlags() & SymbolFlags.FunctionScopedVariable;
                let b = param.getDeclarations().length === 1;
                let c = Node.isParameterDeclaration(param.getDeclarations()[0]);
                const d = (param.getDeclarations()[0].compilerNode as any)?.dotDotDotToken !== undefined;
                return a && b && c && d;
              }
              if (isRestParameter(param)) {
                return `...${name}: ${value}`;
              }
              return `${name}: ${value}`;
            })
            .join(', ');
          const returnType = flattenType(sig.getReturnType(), sourceFile, seenTypes);
          return `(${params}) => ${returnType}`;
        })
        .join(' & ');
      seenTypes.set(typeText, result);
      return result;
    } else {
      const properties = type.getProperties();
      if (properties.length === 0) return '{}';

      const members = properties.map((prop) => {
        const propType = prop.getTypeAtLocation(sourceFile);
        return `"${prop.getName()}": ${flattenType(propType, sourceFile, seenTypes)}`;
      });

      let result = `{ ${members.join('; ')} }`;
      seenTypes.set(typeText, result);
      return result;
    }
  }

  if (type.isLiteral()) {
    let result = JSON.stringify(type.getLiteralValue());
    seenTypes.set(typeText, result);
    return result;
  }

  const symbol = type.getSymbol();
  if (symbol) {
    const declaration = symbol.getDeclarations()[0];
    if (declaration) {
      if (Node.isTypeAliasDeclaration(declaration) || Node.isInterfaceDeclaration(declaration)) {
        const aliasType = declaration.getType();
        let result = flattenType(aliasType, sourceFile, seenTypes);
        seenTypes.set(typeText, result);
        return result;
      }
    }
  }

  seenTypes.set(typeText, typeText);
  // For other types, return the text representation
  return typeText;
}

async function generateFlattenedTypes(configPath: string, routerPath: string, outputPath: string) {
  const project = new Project({
    tsConfigFilePath: configPath,
  });

  const sourceFile = project.addSourceFileAtPath(routerPath);
  debugger;
  const appRouterVar = sourceFile.getVariableDeclaration('api');

  if (!appRouterVar) {
    throw new Error('Could not find appRouter in the specified file');
  }

  const appRouterType = appRouterVar.getType();
  const types = new Map<string, string>();
  const flattenedType = flattenType(appRouterType, sourceFile, types);
  fs.writeFileSync('./ignore/types.txt', Array.from(types).join('\n\n\n'));

  console.log('done flattening');
  // console.log(flattenedType);
  fs.writeFileSync(outputPath, await runPrettier('type API =' + flattenedType));
  /*
  const outputFile = project.createSourceFile(outputPath, '', { overwrite: true });
  outputFile.addTypeAlias({
    name: 'AppRouter',
    type: flattenedType,
    isExported: true,
  });
  console.log('wrting')

  outputFile.saveSync();
*/
  console.log(`Flattened types written to: ${outputPath}`);
}
async function runPrettier(code: string) {
  const {format} = await import('prettier');
  return format(code, {
    parser: 'typescript',
    tabWidth: 2,
    singleQuote: true,
    printWidth: 120,
    bracketSpacing: false,
    trailingComma: 'es5',
    endOfLine: 'auto',
  });
}

// Usage
const configPath = process.argv[2];
const routerPath = process.argv[3];
const outputPath = process.argv[4];

if (!configPath || !routerPath || !outputPath) {
  console.error('Usage: ts-node flatten-trpc-types.ts <path_to_tsconfig.json> <path_to_router_file> <output_path>');
  process.exit(1);
}

generateFlattenedTypes(configPath, routerPath, outputPath)
  .then(() => {
    console.log('done');
    process.exit(1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
