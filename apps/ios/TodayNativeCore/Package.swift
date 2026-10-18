// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TodayNativeCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "TodayNativeCore", targets: ["TodayNativeCore"])],
    targets: [
        .target(name: "TodayNativeCore"),
        .testTarget(name: "TodayNativeCoreTests", dependencies: ["TodayNativeCore"],
                    resources: [.copy("Fixtures")]),
    ]
)
