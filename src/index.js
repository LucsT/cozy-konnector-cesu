const {
  BaseKonnector,
  log,
  requestFactory,
  saveBankingDocuments,
  errors
} = require('cozy-konnector-libs')
let request = requestFactory()
const j = request.jar()
request = requestFactory({
  cheerio: false,
  jar: j,
  debug: false
})
const moment = require('moment')

const baseUrl = 'https://www.cesu.urssaf.fr/'
const loginUrl = baseUrl + 'info/accueil.login.do'

module.exports = new BaseKonnector(start)

function start(fields) {
  return authenticate(fields.login, fields.password)
    .then(getCesuNumber)
    .then(cesuNum => getBulletinsList(cesuNum))
    .then(entries => {
      log('info', 'Fetching payslips')
      return saveBankingDocuments(entries, fields, {
        doctype: 'io.cozy.payslips',
        identifiers: ['cesu']
      })
    })
}

function authenticate(login, password) {
  log('info', 'Authenticating...')
  return request({
    method: 'POST',
    uri: loginUrl,
    form: {
      username: login,
      password: password
    },
    resolveWithFullResponse: true
  }).catch(err => {
    if (err.statusCode === 401) {
      if (
        err.error &&
        err.error.listeMessages &&
        err.error.listeMessages.length &&
        err.error.listeMessages[0].contenu
      ) {
        log('error', err.error.listeMessages[0].contenu)
      }
      throw new Error(errors.LOGIN_FAILED)
    } else if (err.statusCode === 500) {
      throw new Error(errors.VENDOR_DOWN)
    } else {
      throw err
    }
  })
}

function getCesuNumber() {
  const infoCookie = j
    .getCookies(loginUrl)
    .find(cookie => cookie.key === 'EnligneInfo')
  var cesuNumMatch = infoCookie.value.match('%22numerocesu%22%3A%22(.+?)%22')
  if (cesuNumMatch) {
    log('info', 'Cesu number found in page')
    return cesuNumMatch[1]
  } else {
    log('error', 'Could not get the CESU number in the cookie')
    throw new Error(errors.VENDOR_DOWN)
  }
}

function getBulletinsList(cesuNum) {
  const url =
    baseUrl +
    'cesuwebdec/employeurs/' +
    cesuNum +
    '/bulletinsSalaire?numInterneSalarie=&dtDebutRecherche=20130101&dtFinRecherche=20500101&numStart=0&nbAffiche=1000&numeroOrdre=0'
  return request({
    url: url,
    json: true
  }).then(body => {
    return body.listeObjets
      .filter(item => item.telechargeable === true)
      .map(item => ({
        fileurl: `${baseUrl}cesuwebdec/employeurs/${cesuNum}/editions/bulletinSalairePE?refDoc=${
          item.referenceDocumentaire
        }`,
        filename: `${item.salarieDTO.nom}_${item.salarieDTO.prenom}_${
          item.periode
        }.pdf`,
        requestOptions: {
          jar: j
        },
        amount: parseFloat(item.salaireNet),
        date: moment(item.dtVersement, 'YYYY/MM/DD').toDate(),
        vendor: 'CESU',
        isEmployee: true,
        beneficiary: `${item.salarieDTO.nom} ${item.salarieDTO.prenom}`
      }))
  })
}
