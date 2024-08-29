"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const ts_morph_1 = require("ts-morph");
const fs = __importStar(require("node:fs"));
const safeTypes = [
    { typeName: 'Date' },
    { typeName: 'boolean' },
    { typeName: 'string' },
    { typeName: 'number' },
    { typeName: 'bigint' },
    { typeName: 'symbol' },
    { typeName: 'undefined' },
    { typeName: 'null' },
    { typeName: 'void' },
    { typeName: 'never' },
    { typeName: 'unknown' },
    { typeName: 'any' },
    { typeName: 'object' },
    { typeName: 'SharedArrayBuffer' },
    { typeName: 'ArrayBuffer' },
    { typeName: 'ArrayBufferView' },
];
function flattenType(type, sourceFile, seenTypes = new Map()) {
    const typeText = type.getText(undefined /* , TypeFormatFlags.NoTypeQuotes */);
    // if its Date, just emit Date, dont introspect
    if (safeTypes.find((t) => t.typeName === typeText)) {
        return typeText;
    }
    if (typeText.endsWith('ILayer')) {
        return 'any';
    }
    if (typeText.includes('Response<')) {
        return 'any';
    }
    // console.log('typeText:', typeText);
    if (seenTypes.has(typeText)) {
        if (seenTypes.get(typeText) !== '') {
            debugger;
            return seenTypes.get(typeText);
        }
        else {
            console.log('seen:', typeText);
        }
    }
    seenTypes.set(typeText, '');
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
    if (type.isArray()) {
        let result = `Array<${flattenType(type.getArrayElementType(), sourceFile, seenTypes)}>`;
        seenTypes.set(typeText, result);
        return result;
    }
    if (type.isObject()) {
        const properties = type.getProperties();
        if (properties.length === 0)
            return '{}';
        const members = properties.map((prop) => {
            const propType = prop.getTypeAtLocation(sourceFile);
            if ('accepted' === prop.getName()) {
                // debugger;
            }
            if (prop.getName() === '_def') {
                // return '_def: any';
            }
            if (prop.getName() === 'secure') {
                debugger;
            }
            return `"${prop.getName()}": ${flattenType(propType, sourceFile, seenTypes)}`;
        });
        let result = `{ ${members.join('; ')} }`;
        seenTypes.set(typeText, result);
        return result;
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
            if (ts_morph_1.Node.isTypeAliasDeclaration(declaration) || ts_morph_1.Node.isInterfaceDeclaration(declaration)) {
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
function generateFlattenedTypes(configPath, routerPath, outputPath) {
    const project = new ts_morph_1.Project({
        tsConfigFilePath: configPath,
    });
    const sourceFile = project.addSourceFileAtPath(routerPath);
    const appRouterVar = sourceFile.getVariableDeclaration('appRouter');
    if (!appRouterVar) {
        throw new Error('Could not find appRouter in the specified file');
    }
    const appRouterType = appRouterVar.getType();
    const types = new Map();
    const flattenedType = flattenType(appRouterType, sourceFile, types);
    fs.writeFileSync('types.txt', Array.from(types).join('\n\n\n'));
    console.log('done flattening');
    // console.log(flattenedType);
    fs.writeFileSync(outputPath, 'type AppRouter =' + flattenedType);
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
// Usage
const configPath = process.argv[2];
const routerPath = process.argv[3];
const outputPath = process.argv[4];
if (!configPath || !routerPath || !outputPath) {
    console.error('Usage: ts-node flatten-trpc-types.ts <path_to_tsconfig.json> <path_to_router_file> <output_path>');
    process.exit(1);
}
generateFlattenedTypes(configPath, routerPath, outputPath);
