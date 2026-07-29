const { matchCampaign } = require('./services/ai/matching/campaignMatcher');
 
const testCases = ['SummerSale25', 'HolidayLunch', 'Back2School', 'XYZ Campaign'];
 
(async () => {
  for (const name of testCases) {
    const result = await matchCampaign(name);
    console.log(result);
  }
})();