# Face++
## Face recognition for Homey ##
Use snapshots from a camera connected to Homey, and let Face++ do AI based face recognition. For every face the app detects, a flow will be triggered. Homey will automatically try to match the faces to a set of known faces that you can upload yourself. The app will also estimate gender, age, emotion, and whether the person is wearing (sun)glasses or a mask.

<img src="https://aws1.discourse-cdn.com/business4/uploads/athom/original/3X/2/4/249732c22df6c415cd2e82ce50477b050ab799c7.jpeg" alt="Face++" width="300">

## Use cases ##
* Presence detection
* Security
* Face based access control
* Fun

## Privacy ##
The Homey app uses a cloud based face recognition service called Face++. Using the Face++ service has severe privacy implications. Use at own risk. Read and understand your local privacy legislation, and the terms of use from Face++.

## Performance ##
The results depend very much on the quality of the snapshots. A face will be best recognized if the lighting is good and when the face is frontal with a width of at least 75 pixels. In practice it means you need to have good control over when the snapshot is taken in a videostream. The free Face++ service allows you to upload around 1 or 2 images per second. The face detection usually is ready within 1 to 3 seconds from uploading an image (via an action flowcard).

## Test image ##
To make testing your flow easier, a test image is available as global image token. It has five faces in it.

<img src="https://aws1.discourse-cdn.com/business4/uploads/athom/original/3X/f/e/fe69c1e5aeaf6e42850f55f89064f07d58e6bd64.jpeg" alt="Face++" width="300">


