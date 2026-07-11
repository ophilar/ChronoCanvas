const cv = require('@techstark/opencv-js');

setTimeout(() => {
  console.log('cv loaded?', cv.getBuildInformation() ? 'yes' : 'no');
  try {
    let orb = new cv.ORB(500); 
    console.log('ORB via new:', orb);
  } catch(e) {
    try {
      let orb2 = cv.ORB_create();
      console.log('ORB via create:', orb2);
    } catch(e2) {
      try {
        let akaze = new cv.AKAZE();
        console.log('AKAZE via new:', akaze);
      } catch (e3) {
        console.log('Error creating feature detector:', e3.message);
      }
    }
  }
}, 100);
