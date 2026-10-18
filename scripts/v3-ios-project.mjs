// Deterministic Xcode project generation; uses only Node built-ins, no package installation.
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
const id = (name) =>
  createHash('sha256').update(`today-native-v1:${name}`).digest('hex').slice(0, 24).toUpperCase()
const q = JSON.stringify
const objects = []
const put = (name, isa, fields) => {
  objects.push(`${id(name)} = { isa = ${isa}; ${fields} };`)
  return id(name)
}
const list = (names) => `(${names.map((name) => `${id(name)},`).join(' ')})`
for (const file of [
  'TodayNativeApp.swift',
  'DailyHubStore.swift',
  'DailyHubView.swift',
  'fictional-overview.json',
  'Info.plist',
  'TodayNativeUITests.swift',
]) {
  put(
    file,
    'PBXFileReference',
    `lastKnownFileType = ${file.endsWith('.swift') ? 'sourcecode.swift' : file.endsWith('.plist') ? 'text.plist.xml' : 'text.json'}; path = ${q(file)}; sourceTree = "<group>";`,
  )
  put(`build-${file}`, 'PBXBuildFile', `fileRef = ${id(file)};`)
}
put(
  'appProduct',
  'PBXFileReference',
  'explicitFileType = wrapper.application; path = TodayNative.app; sourceTree = BUILT_PRODUCTS_DIR;',
)
put(
  'testProduct',
  'PBXFileReference',
  'explicitFileType = wrapper.cfbundle; path = TodayNativeUITests.xctest; sourceTree = BUILT_PRODUCTS_DIR;',
)
put('package', 'XCLocalSwiftPackageReference', 'relativePath = TodayNativeCore;')
put(
  'packageProduct',
  'XCSwiftPackageProductDependency',
  `package = ${id('package')}; productName = TodayNativeCore;`,
)
put('packageBuild', 'PBXBuildFile', `productRef = ${id('packageProduct')};`)
put(
  'appGroup',
  'PBXGroup',
  `children = ${list(['TodayNativeApp.swift', 'DailyHubStore.swift', 'DailyHubView.swift', 'fictional-overview.json', 'Info.plist'])}; path = TodayNative; sourceTree = "<group>";`,
)
put(
  'testGroup',
  'PBXGroup',
  `children = ${list(['TodayNativeUITests.swift'])}; path = TodayNativeUITests; sourceTree = "<group>";`,
)
put(
  'products',
  'PBXGroup',
  `children = ${list(['appProduct', 'testProduct'])}; name = Products; sourceTree = "<group>";`,
)
put(
  'root',
  'PBXGroup',
  `children = ${list(['appGroup', 'testGroup', 'products'])}; sourceTree = "<group>";`,
)
for (const [name, isa, files] of [
  [
    'appSources',
    'PBXSourcesBuildPhase',
    ['build-TodayNativeApp.swift', 'build-DailyHubStore.swift', 'build-DailyHubView.swift'],
  ],
  ['appResources', 'PBXResourcesBuildPhase', ['build-fictional-overview.json']],
  ['appFrameworks', 'PBXFrameworksBuildPhase', ['packageBuild']],
  ['testSources', 'PBXSourcesBuildPhase', ['build-TodayNativeUITests.swift']],
  ['testResources', 'PBXResourcesBuildPhase', []],
  ['testFrameworks', 'PBXFrameworksBuildPhase', []],
])
  put(
    name,
    isa,
    `buildActionMask = 2147483647; files = ${list(files)}; runOnlyForDeploymentPostprocessing = 0;`,
  )
put(
  'testProxy',
  'PBXContainerItemProxy',
  `containerPortal = ${id('project')}; proxyType = 1; remoteGlobalIDString = ${id('appTarget')}; remoteInfo = TodayNative;`,
)
put(
  'testDependency',
  'PBXTargetDependency',
  `target = ${id('appTarget')}; targetProxy = ${id('testProxy')};`,
)
put(
  'appTarget',
  'PBXNativeTarget',
  `buildConfigurationList = ${id('appConfigurations')}; buildPhases = ${list(['appSources', 'appFrameworks', 'appResources'])}; buildRules = (); dependencies = (); name = TodayNative; packageProductDependencies = ${list(['packageProduct'])}; productName = TodayNative; productReference = ${id('appProduct')}; productType = "com.apple.product-type.application";`,
)
put(
  'testTarget',
  'PBXNativeTarget',
  `buildConfigurationList = ${id('testConfigurations')}; buildPhases = ${list(['testSources', 'testFrameworks', 'testResources'])}; buildRules = (); dependencies = ${list(['testDependency'])}; name = TodayNativeUITests; productName = TodayNativeUITests; productReference = ${id('testProduct')}; productType = "com.apple.product-type.bundle.ui-testing";`,
)
for (const config of ['Debug', 'Release']) {
  const debug = config === 'Debug'
  put(
    `project${config}`,
    'XCBuildConfiguration',
    `name = ${config}; buildSettings = { CLANG_ENABLE_MODULES = YES; CLANG_ENABLE_OBJC_ARC = YES; SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_VERSION = 5.0; SWIFT_STRICT_CONCURRENCY = complete; ${debug ? 'ONLY_ACTIVE_ARCH = YES; SWIFT_OPTIMIZATION_LEVEL = "-Onone"; SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;' : 'SWIFT_COMPILATION_MODE = wholemodule;'} };`,
  )
  put(
    `app${config}`,
    'XCBuildConfiguration',
    `name = ${config}; buildSettings = { CODE_SIGNING_ALLOWED = NO; GENERATE_INFOPLIST_FILE = NO; INFOPLIST_FILE = TodayNative/Info.plist; PRODUCT_BUNDLE_IDENTIFIER = park.taccity.today.preview; PRODUCT_NAME = "$(TARGET_NAME)"; CURRENT_PROJECT_VERSION = 1; MARKETING_VERSION = 0.1.0; TARGETED_DEVICE_FAMILY = "1,2"; SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"; ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS = YES; };`,
  )
  put(
    `test${config}`,
    'XCBuildConfiguration',
    `name = ${config}; buildSettings = { CODE_SIGNING_ALLOWED = NO; GENERATE_INFOPLIST_FILE = YES; PRODUCT_BUNDLE_IDENTIFIER = park.taccity.today.preview.uitests; PRODUCT_NAME = "$(TARGET_NAME)"; TARGETED_DEVICE_FAMILY = "1,2"; TEST_TARGET_NAME = TodayNative; };`,
  )
}
for (const scope of ['project', 'app', 'test'])
  put(
    `${scope}Configurations`,
    'XCConfigurationList',
    `buildConfigurations = ${list([`${scope}Debug`, `${scope}Release`])}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;`,
  )
put(
  'project',
  'PBXProject',
  `attributes = { BuildIndependentTargetsInParallel = YES; LastUpgradeCheck = 2700; TargetAttributes = { ${id('appTarget')} = { CreatedOnToolsVersion = 27.0; }; ${id('testTarget')} = { CreatedOnToolsVersion = 27.0; TestTargetID = ${id('appTarget')}; }; }; }; buildConfigurationList = ${id('projectConfigurations')}; compatibilityVersion = "Xcode 14.0"; developmentRegion = ja; hasScannedForEncodings = 0; knownRegions = (ja, en, Base); mainGroup = ${id('root')}; packageReferences = ${list(['package'])}; productRefGroup = ${id('products')}; projectDirPath = ""; projectRoot = ""; targets = ${list(['appTarget', 'testTarget'])};`,
)
const project = new URL('../apps/ios/TodayNative.xcodeproj/', import.meta.url)
await mkdir(new URL('xcshareddata/xcschemes/', project), { recursive: true })
await writeFile(
  new URL('project.pbxproj', project),
  `// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n${objects.join('\n')}\n}; rootObject = ${id('project')}; }\n`,
)
const reference = (name, target, product) =>
  `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${id(target)}" BuildableName="${product}" BlueprintName="${name}" ReferencedContainer="container:TodayNative.xcodeproj"/>`
const app = reference('TodayNative', 'appTarget', 'TodayNative.app'),
  test = reference('TodayNativeUITests', 'testTarget', 'TodayNativeUITests.xctest')
await writeFile(
  new URL('xcshareddata/xcschemes/TodayNative.xcscheme', project),
  `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.3">
 <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">${app}</BuildActionEntry><BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">${test}</BuildActionEntry></BuildActionEntries></BuildAction>
 <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">${test}</TestableReference></Testables></TestAction>
 <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="NO"><BuildableProductRunnable runnableDebuggingMode="0">${app}</BuildableProductRunnable></LaunchAction>
 <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">${app}</BuildableProductRunnable></ProfileAction>
 <AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
`,
)
process.stdout.write(
  'Local-only Simulator Xcode project generated; signing disabled; no accounts or external dependencies.\n',
)
