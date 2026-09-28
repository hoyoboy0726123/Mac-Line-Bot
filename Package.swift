// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "MacLineBot",
    platforms: [.macOS(.v26)],
    products: [
        .executable(name: "MacLineBot", targets: ["MacLineBot"])
    ],
    targets: [
        .executableTarget(
            name: "MacLineBot",
            path: "Sources/MacLineBot",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
