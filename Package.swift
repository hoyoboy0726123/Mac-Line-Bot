// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "GuDian",
    platforms: [.macOS(.v26)],
    products: [
        .executable(name: "GuDian", targets: ["GuDian"])
    ],
    targets: [
        .executableTarget(
            name: "GuDian",
            path: "Sources/GuDian",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
