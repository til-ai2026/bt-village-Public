# lib

- `pose.js` — 시험용 동작 인식 모듈 (카메라 영상은 브라우저 안에서만 처리, 저장·전송하지 않음)
- `mediapipe/` — [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) 0.10.14 (`vision_bundle.mjs`, `wasm/`), Apache License 2.0, © Google LLC
- `models/pose_landmarker_lite.task` — MediaPipe Pose Landmarker (lite, float16 v1), Apache License 2.0, © Google LLC

외부 주소 없이 동작하도록 저장소에 넣었습니다. 불러오기에 실패하면 같은 버전의 CDN으로 한 번 더 시도합니다.
- `three/three.module.min.js`, `three/addons/` (GLTFLoader) — [three.js](https://threejs.org) r160, MIT License (`three/LICENSE`). `three`라는 이름으로 불러오도록 페이지에 import map을 둡니다.
