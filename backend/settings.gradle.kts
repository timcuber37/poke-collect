// JDK 23 is past EOL, so it is no longer packaged by Homebrew or most distros.
// This resolver lets Gradle download the toolchain the build pins (matching the
// eclipse-temurin:23 images the Dockerfile builds on) instead of requiring a
// preinstalled JDK 23 on every developer machine.
plugins {
	id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "tcg-tracker"
