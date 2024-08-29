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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
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
    { typeName: 'Event' },
    { typeName: 'EventTarget' },
    { typeName: 'EventListener' },
    { typeName: 'AbortSignal' },
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
const fuzzySafeTypes = [
    { typeName: 'ILayer' },
    { typeName: 'ProcedureOptions' },
    { typeName: 'Response<' },
    { typeName: 'PromiseLike<' },
];
function flattenType(type, sourceFile, seenTypes = new Map()) {
    const typeText = type.getText(undefined, ts_morph_1.TypeFormatFlags.NoTruncation |
        ts_morph_1.TypeFormatFlags.UseTypeOfFunction |
        ts_morph_1.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
        ts_morph_1.TypeFormatFlags.WriteTypeArgumentsOfSignature |
        ts_morph_1.TypeFormatFlags.OmitParameterModifiers |
        ts_morph_1.TypeFormatFlags.UseFullyQualifiedType);
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
            return seenTypes.get(typeText);
        }
        else {
            // todo support writing recursive type, return out a placeholder and then write that placeholder out
            return 'any';
            console.log('seen:', typeText);
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
        let result = `Array<${flattenType(type.getArrayElementType(), sourceFile, seenTypes)}>`;
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
                    function isRestParameter(param) {
                        var _a;
                        let a = param.getFlags() & ts_morph_1.SymbolFlags.FunctionScopedVariable;
                        let b = param.getDeclarations().length === 1;
                        let c = ts_morph_1.Node.isParameterDeclaration(param.getDeclarations()[0]);
                        const d = ((_a = param.getDeclarations()[0].compilerNode) === null || _a === void 0 ? void 0 : _a.dotDotDotToken) !== undefined;
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
        }
        else {
            const properties = type.getProperties();
            if (properties.length === 0)
                return '{}';
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
    return __awaiter(this, void 0, void 0, function* () {
        const project = new ts_morph_1.Project({
            tsConfigFilePath: configPath,
        });
        const sourceFile = project.addSourceFileAtPath(routerPath);
        debugger;
        const appRouterVar = sourceFile.getVariableDeclaration('api');
        if (!appRouterVar) {
            throw new Error('Could not find appRouter in the specified file');
        }
        const appRouterType = appRouterVar.getType();
        const types = new Map();
        const flattenedType = flattenType(appRouterType, sourceFile, types);
        fs.writeFileSync('./ignore/types.txt', Array.from(types).join('\n\n\n'));
        console.log('done flattening');
        // console.log(flattenedType);
        fs.writeFileSync(outputPath, yield runPrettier('type API =' + flattenedType));
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
    });
}
function runPrettier(code) {
    return __awaiter(this, void 0, void 0, function* () {
        const { format } = yield Promise.resolve().then(() => __importStar(require('prettier')));
        return format(code, {
            parser: 'typescript',
            tabWidth: 2,
            singleQuote: true,
            printWidth: 120,
            bracketSpacing: false,
            trailingComma: 'es5',
            endOfLine: 'auto',
        });
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
