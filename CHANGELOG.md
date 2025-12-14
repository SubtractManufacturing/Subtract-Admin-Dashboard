# Changelog

## [1.2.1](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/compare/v1.2.0...v1.2.1) (2025-12-14)


### Bug Fixes

* add 3d part dimensions to viewer modal ([061a855](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/061a855182d2924cdcd44749b5a3a3843d6345cd))
* add drawing viewer/thumbnails to order details page line items ([990c777](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/990c777df41ed5416d9337e6d05684000f4dacf0))
* correct quote PDF to use current date instead of quote created date ([55a453f](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/55a453f04895b6a278c6cc6d618ca677db104579))
* externalize mupdf to resolve runtime WASM error ([1df465e](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/1df465e79dbbee0c337f73f0e55174c8cbf0a206))
* fix lint ([11ed002](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/11ed002f92fbd43aedd66a7c93d90aeb843a69c9))
* fix quote calculator working only once ([127cd79](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/127cd7920ec216f8e00b9b4778355ad9367c078b))
* fix scroll behaviour on price calculator modal ([d8e63bf](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/d8e63bf42ea423c02f02cac0c7bf04f27793ed92))
* **quotes:** add mode support to calculator modal for single vs all parts pricing ([cecf6b6](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/cecf6b63ba246b771e94dc45efa3e3a88b92c921))
* resolve lint and typecheck errors ([bb31bc3](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/bb31bc3cf849406edf275a1911a4b617045e9d52))
* update part dimensions for order parts too ([d6114bf](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/d6114bf13509c8b718a6e7f567ec5fac51ee8479))
* update vite build target to es2022 to support top-level await ([b43d2c5](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/b43d2c574b8c995d97a6bd67f85329d7f2a39021))

## [1.2.0](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/compare/v1.1.1...v1.2.0) (2025-12-11)


### Features

* implement CAD version control and React Email templates ([a6f498c](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/a6f498c9fe1cb1b7f2bc0463e3196c9d08ad7c7e))

## [1.1.1](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/compare/v1.1.0...v1.1.1) (2025-12-11)


### Bug Fixes

* email integration and fix duplicate order# bug ([00a861a](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/00a861af4772a7cba202b614ced745d7c4cd088b))

## [1.1.0](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/compare/v1.0.1...v1.1.0) (2025-12-06)


### Features

* better in-app versioning ([505d815](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/505d81520af346b7627e67915ff46cd4692c01a2))

## [1.0.1](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/compare/v1.0.0...v1.0.1) (2025-11-26)


### Bug Fixes

* add automated deployment pipeline ([4de6c91](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/4de6c91f0c8f83699285aff2aefd6c64a457ea5d))

## 1.0.0 (2025-11-25)


### Bug Fixes

* change docker image to alpine and install chromium ([#50](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/issues/50)) ([7b095d6](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/7b095d69475bf18b32e13a74c370f5b8d2ab02a6))
* PDF downloading issues after refactor ([af9f4d0](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/af9f4d07abb1677a6c5e9e79d69b2cb91037b86d))
* PDF generator hotfix ([5522f11](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/5522f11c03e30f88a3e425cf8aca14e65311f02d))
* remove Error object from AbortController.abort() call ([8bb703f](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/8bb703f4b77f074470762086838377941e958f5f))
* replace AbortSignal with Promise.race timeout approach ([ea9ac82](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/ea9ac8237a3feb8e62fdf09749b2a694102566e3))
* resolve stream reader conflict in conversion service timeout handling ([#37](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/issues/37)) ([4dba386](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/4dba38636fb16cc3e8b934591cb09af8fffb7eab))
* temporarily remove timeout to isolate polyfill issues ([f1362dd](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/f1362dd9f352b321ed12f78bbb44cc9c4c40c5f4))
* update line item event logs ([#42](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/issues/42)) ([42ea6d0](https://github.com/SubtractManufacturing/Subtract-Admin-Dashboard/commit/42ea6d0f4a39cc35116cb5d404f967ba8a5c951d))
