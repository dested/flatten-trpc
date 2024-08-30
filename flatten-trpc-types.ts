import {Project, Symbol, SourceFile, Node, Type, TypeFormatFlags, SymbolFlags} from 'ts-morph';
import * as fs from 'node:fs';

const MAX_REUSE_COUNT = 2;
const MIN_LENGTH_FOR_REUSE = 150;

const passThroughTypes = [
  'any',
  'Date',
  'boolean',
  'string',
  'number',
  'bigint',
  'symbol',
  'undefined',
  'Event',
  'EventTarget',
  'EventListener',
  'AbortSignal',
  'null',
  'void',
  'never',
  'unknown',
  'any',
  'object',
  'SharedArrayBuffer',
  'ArrayBuffer',
  'ArrayBufferView',
];

const hardcodedTypes = ['ProcedureOptions'];

function flattenType(
  type: Type,
  sourceFile: SourceFile,
  seenTypes: Map<
    string,
    {count: number; name: string; body: string; recursive: boolean; originalText: string}
  > = new Map()
): string {
  if (!type) {
    console.log('type invalid');
    return 'unknown';
  }
  const typeText = type.getText(
    undefined,
    TypeFormatFlags.NoTruncation |
      TypeFormatFlags.UseTypeOfFunction |
      TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
      TypeFormatFlags.WriteTypeArgumentsOfSignature |
      TypeFormatFlags.OmitParameterModifiers |
      TypeFormatFlags.UseFullyQualifiedType
  );

  if (passThroughTypes.find((t) => t === typeText)) {
    return typeText;
  }

  if (hardcodedTypes.find((t) => typeText.startsWith(t))) {
    if (typeText.includes('ProcedureOptions')) {
      return 'ProcedureOptions';
    }
    return typeText;
  }

  // console.log('typeText:', typeText);

  if (seenTypes.has(typeText)) {
    let v = seenTypes.get(typeText)!;
    v.count++;
    if (v.body === '') {
      v.recursive = true;
    }
    return v.name;
  }

  const realName = type.getSymbol()?.getName();
  const aliasName = type.getAliasSymbol()?.getName();

  if (realName === 'Record' || aliasName === 'Record') {
    if (!type.getTypeArguments()[0] || !type.getTypeArguments()[1]) {
      return typeText;
    }
    let result = `Record<${flattenType(type.getTypeArguments()[0], sourceFile, seenTypes)}, ${flattenType(type.getTypeArguments()[1], sourceFile, seenTypes)}>`;
    return result;
  }

  if (realName === 'Promise') {
    let result = `Promise<${flattenType(type.getTypeArguments()[0], sourceFile, seenTypes)}>`;
    return result;
  }
  if (realName === 'PromiseLike') {
    let result = `PromiseLike<${flattenType(type.getTypeArguments()[0], sourceFile, seenTypes)}>`;
    return result;
  }
  let typeName = generateTypeName(typeText);
  seenTypes.set(typeText, {
    count: 1,
    name: typeName,
    body: '',
    recursive: false,
    originalText: typeText,
  });
  if (type.isUnion()) {
    let result = type
      .getUnionTypes()
      .map((t) => flattenType(t, sourceFile, seenTypes))
      .filter((t) => t)
      .join(' | ');
    seenTypes.get(typeText)!.body = result;
    return typeName;
  }

  if (type.isIntersection()) {
    let result = type
      .getIntersectionTypes()
      .map((t) => flattenType(t, sourceFile, seenTypes))
      .filter((t) => t)
      .join(' & ');
    seenTypes.get(typeText)!.body = result;

    return typeName;
  }
  if (type.getText().startsWith('[')) {
    const tupleTypes = type.getTypeArguments();
    let result = `[${tupleTypes.map((t) => flattenType(t, sourceFile, seenTypes)).join(', ')}]`;
    seenTypes.get(typeText)!.body = result;

    return typeName;
  }

  if (type.isArray()) {
    let result = `Array<${flattenType(type.getArrayElementType()!, sourceFile, seenTypes)}>`;
    seenTypes.get(typeText)!.body = result;
    return result;
  }

  if (type.isObject()) {
    // test if its a {[key:string]: thing}
    const indexType = type.getStringIndexType();
    if (indexType) {
      let result = `{[key: string]: ${flattenType(indexType, sourceFile, seenTypes)}}`;
      seenTypes.get(typeText)!.body = result;
      return typeName;
    }

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
      seenTypes.get(typeText)!.body = result;

      return typeName;
    } else {
      const properties = type.getProperties();

      const members = properties.map((prop) => {
        const propType = prop.getTypeAtLocation(sourceFile);
        let v = flattenType(propType, sourceFile, seenTypes);
        return `"${prop.getName()}": ${v}`;
      });

      let result = `{ ${members.join('; ')} }`;
      seenTypes.get(typeText)!.body = result;
      return typeName;
    }
  }

  if (type.isLiteral()) {
    let result = type.getText();
    seenTypes.get(typeText)!.body = result;

    return typeName;
  }

  const symbol = type.getSymbol();
  if (symbol) {
    const declaration = symbol.getDeclarations()[0];
    if (declaration) {
      if (Node.isTypeAliasDeclaration(declaration) || Node.isInterfaceDeclaration(declaration)) {
        const aliasType = declaration.getType();
        let result = flattenType(aliasType, sourceFile, seenTypes);
        seenTypes.get(typeText)!.body = result;

        return typeName;
      }
    }
  }

  seenTypes.get(typeText)!.body = typeText;

  return typeName;
}

let nextId = 10000000;
function generateTypeName(typeText: string): string {
  // Generate a name based on the type content
  const simplifiedText = typeText.replace(/[^a-zA-Z0-9]/g, '');

  let name = `$$$T${simplifiedText.slice(0, 20)}${(nextId++).toString(36).substr(2, 5)}$$$`;
  if (name === '$$$TfirstNamestringlastNc3e$$$') {
    // debugger;
  }
  return name;
}

function isRestParameter(param: Symbol) {
  let a = param.getFlags() & SymbolFlags.FunctionScopedVariable;
  let b = param.getDeclarations().length === 1;
  let c = Node.isParameterDeclaration(param.getDeclarations()[0]);
  const d = (param.getDeclarations()[0].compilerNode as any)?.dotDotDotToken !== undefined;
  return a && b && c && d;
}

async function generateFlattenedTypes(configPath: string, routerPath: string, outputPath: string) {
  const project = new Project({
    tsConfigFilePath: configPath,
  });

  const sourceFile = project.addSourceFileAtPath(routerPath);
  const appRouterVar = sourceFile.getVariableDeclaration('api');

  if (!appRouterVar) {
    throw new Error('Could not find appRouter in the specified file');
  }

  const appRouterType = appRouterVar.getType();
  const types = new Map<
    string,
    {recursive: boolean; count: number; name: string; body: string; originalText: string}
  >();
  let flattenedType = flattenType(appRouterType, sourceFile, types);
  // fs.writeFileSync('./ignore/types.txt', Array.from(types).join('\n\n\n'));
  debugger;
  console.log(types.size);
  console.log('pre');
  let replacementMap = Array.from(types.values()).map((v) => ({
    name: v.name,
    body: v.body,
    count: v.count,
    recursive: v.recursive,
    originalLength: v.originalText.length,
  }));

  debugger;
  // update all the type references

  for (const item of replacementMap) {
    while (item.body.includes('$$$')) {
      // debugger;
      // console.log(item.body.slice(item.body.indexOf('$$$'), item.body.indexOf('$$$') + 200));
      item.body = efficientStringReplacement(item.body, replacementMap);
    }
  }

  flattenedType = efficientStringReplacement(flattenedType, replacementMap);
  console.log('post');

  let output = '';
  debugger;
  for (const item of replacementMap) {
    if (item.recursive || (item.count > MAX_REUSE_COUNT && item.originalLength > MIN_LENGTH_FOR_REUSE)) {
      output += `type ${item.name.replace(/\$\$\$/g, '')} = ${item.body};\n\n`;
    }
  }
  output += `export type API = ${flattenedType};`;

  console.log('done flattening');
  // console.log(flattenedType);
  fs.writeFileSync(outputPath, output);
  console.log('write non pretty');
  fs.writeFileSync(outputPath, await runPrettier(output));
  console.log('write pretty');
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

interface Replacement {
  start: number;
  end: number;
  name: string;
}

interface ReplacementMap {
  name: string;
  body: string;
  count: number;
  recursive: boolean;
  originalLength: number;
}
function efficientStringReplacement(input: string, replacementMap: ReplacementMap[]): string {
  const regex = /\$\$\$(\w+)\$\$\$/g;
  const replacements: Replacement[] = [];
  let match;

  while ((match = regex.exec(input)) !== null) {
    replacements.push({
      start: match.index,
      end: match.index + match[0].length,
      name: match[1],
    });
  }
  // Sort replacements in descending order of their start index
  replacements.sort((a, b) => b.start - a.start);

  if (!input) {
    debugger;
  }
  // Create an array of characters from the input string
  const chars = input.split('');

  // Perform replacements
  for (const replacement of replacements) {
    let replacementMapElement = replacementMap.find((e) => e.name === '$$$' + replacement.name + '$$$');
    if (replacementMapElement) {
      if (replacementMapElement.recursive) {
        chars.splice(replacement.start, replacement.end - replacement.start, replacement.name);
      } else if (replacementMapElement.count <= MAX_REUSE_COUNT) {
        chars.splice(replacement.start, replacement.end - replacement.start, replacementMapElement.body);
      } else {
        if (replacementMapElement.originalLength <= MIN_LENGTH_FOR_REUSE) {
          chars.splice(replacement.start, replacement.end - replacement.start, replacementMapElement.body);
        } else {
          chars.splice(replacement.start, replacement.end - replacement.start, replacement.name);
        }
      }
    }
  }
  // Join the characters back into a string
  return chars.join('');
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
