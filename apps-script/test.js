function testLetuViaZenRows() {
  var zr = PropertiesService.getScriptProperties().getProperty('ZENROWS_API_KEY');
  var token = PropertiesService.getScriptProperties().getProperty('LETU_TOKEN');
  var target = 'https://seller-api.letu.ru/api/v1/product/list';
  var zurl = 'https://api.zenrows.com/v1/?apikey=' + zr +
             '&url=' + encodeURIComponent(target) +
             '&premium_proxy=true&proxy_country=ru&custom_headers=true';
  var resp = UrlFetchApp.fetch(zurl, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + token,
      'User-Agent': 'LETU Merchant 1.0'
    },
    payload: JSON.stringify({ pagination: { type: 'OFFSET', limit: 10, offset: 0 } }),
    muteHttpExceptions: true
  });
  Logger.log('HTTP ' + resp.getResponseCode());
  Logger.log(resp.getContentText().substring(0, 2000));
}
