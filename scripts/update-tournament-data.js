const https = require('https');
const mongodb = require('mongodb')

const uri = process.env.DB_URI;

function httpGet(url, options, callback) {
  return https.get(url, options, (res) => {
    const { statusCode } = res;
    const contentType = res.headers['content-type'];
    let error;
    if (statusCode != 200) {
      error = new Error('Request Failed.\n' + 
                        `Status Code: ${statusCode}`);
    } else if (!/^application\/json/.test(contentType)) {
      error = new Error('Invalid content-type.\n' + 
          `Expected application/json but received ${contentType}`);
    }
    if (error) {
      console.log(error.message);
      console.log(url);
      res.resume();
    }

    res.setEncoding('utf8');
    let rawData = '';
    res.on('data', (chunk) => {rawData += chunk;});
    res.on('end', () => {
      try {
        const parsedData = JSON.parse(rawData);
        callback(parsedData);
      } catch (e) {
        console.log(e.message);
      }
    });
  }).on('error', (e) => {
    console.log(`Got error: ${e.message}`);
  });
}

function updateTournaments(isSync, start, end) {
  let startDate = new Date();
  let endDate = new Date();
  if (isSync) {
    startDate = new Date(start);
    endDate = new Date(end);
  } else {
    startDate.setDate(startDate.getDate()-1);
  }
  const fetchTourneysURL = `https://majestic.battlefy.com/hearthstone-masters/tournaments?start=${startDate.toJSON()}&end=${endDate.toJSON()}`;
  httpGet(fetchTourneysURL, {}, processTournaments);
}

function handleSwiss(id, slug, tournamentLoc, tournamentNum, stageId, top8Id, startTime) {
  if (top8Id) {
    const fetchTop8Url = `https://dtmwra1jsgyb0.cloudfront.net/stages/${top8Id}/standings`;
    httpGet(fetchTop8Url, {}, standings => processTop8(id, slug, standings, tournamentLoc, tournamentNum, startTime));
  }
}

function handleSingleElim(id, slug, tournamentLoc, tournamentNum, stageId, startTime) {
  const fetchStandingsUrl = `https://dtmwra1jsgyb0.cloudfront.net/stages/${stageId}/standings`;
  httpGet(fetchStandingsUrl, {}, standings => {
    handleSingleElimStandings(id, slug, standings, tournamentLoc, tournamentNum, startTime);
  });
  const fetchMatchesUrl = `https://dtmwra1jsgyb0.cloudfront.net/stages/${stageId}/matches`;
  httpGet(fetchMatchesUrl, {}, matches => {
    handleQualifiers(id, slug, matches, tournamentLoc, tournamentNum, startTime);
  });
}

function handleQualifiers(id, slug, matches, tournamentLoc, tournamentNum) {
  players = {};
  matches.forEach(match => {
    if (match.isBye) {
      return;
    }
    ['top', 'bottom'].forEach(position => {
      const playerData = match[position];
      const playerName = playerData.team.name;
      const player = players[playerName] || {name: playerName, wins: 0, losses: 0}
      if (playerData.winner) {
        player.wins++;
      } else {
        player.losses++;
      }
      players[playerName] = player;
    })
  });
  writeStats(id, slug, players, tournamentLoc, tournamentNum);
  aggregateStats(tournamentLoc);
}

function writeStats(id, slug, players, tournamentLoc, tournamentNum) {
  if (players.length===0) {
    return;
  }
  mongodb.MongoClient.connect(uri, {useUnifiedTopology: true, useNewUrlParser: true}, (err, client) => {
    if (err) throw err;
    const db = client.db();
    const stats = db.collection('stats');
    let count = 0;
    stats.updateOne({_id: id},{$set: {id: id, slug: slug, tournamentId: tournamentLoc, tournamentNum: tournamentNum, players: players}}, {upsert:true}, (err, res) => {
      if (err) throw err;-
      client.close();
    });
  });
}

function aggregateStats(tournamentLoc) {
  mongodb.MongoClient.connect(uri, {useUnifiedTopology: true, useNewUrlParser: true}, (err, client)=> {
    if (err) {
      res.status(500).json({'error': err});
      return;
    }

    const db = client.db();
    const statsCollection = db.collection('stats');
    const tournamentStats = {};
    const aggregatedStats = db.collection('aggregateStats');
    statsCollection.find({
      'tournamentId': {$eq: tournamentLoc}
    }).toArray(function (err, result) {
      if (err) {
        res.status(500).json({'error': err});
        client.close();
        return;
      }
      result.forEach(stats => {
        Object.values(stats.players).forEach(player => {
          const playerName = player['name'];
          const playerStats = tournamentStats[playerName] || {name: playerName, count: 0, wins: 0, losses: 0};
          playerStats.count++;
          playerStats.wins += player['wins'];
          playerStats.losses += player['losses'];
          const numGames = playerStats.losses + playerStats.wins;
          playerStats.winrate = numGames > 0 ? playerStats.wins / numGames : 0;
          tournamentStats[playerName] = playerStats;
        })
      })
      aggregatedStats.updateOne({_id: tournamentLoc},{$set: {tournamentId: tournamentLoc, playerStats: tournamentStats}}, {upsert:true}, (err, res) => {
        if (err) throw err;
        client.close();
      });
    });
  });
}

function handleSingleElimStandings(id, slug, standings, tournamentLoc, tournamentNum, startTime) {
  const qualified = standings.filter(e=>e['place']<=1).map(a=>a['team']['name']);
  if (qualified.length != 0) {
    writeWinner(id, qualified, startTime);
  }
  const top8 = standings.filter(e=>e['place']<=8).map(x=>x['team']['name']).filter(x=>x);
  writeTop8(id, slug, top8, tournamentLoc, tournamentNum);
}

function manualTop8(id, slug, tournamentLoc, tournamentNum) {
  const fetchTourneyURL = `https://dtmwra1jsgyb0.cloudfront.net/tournaments/${id}`;

  httpGet(fetchTourneyURL, {}, result=> {
    const stageId = result['stageIDs'][0];
    if (stageId) {
      const fetchStandingsUrl = `https://dtmwra1jsgyb0.cloudfront.net/stages/${stageId}/standings`;
      httpGet(fetchStandingsUrl, {}, standings => {
        handleSingleElimStandings(id, slug, standings, tournamentLoc, tournamentNum);
      });
    }
  });
}

function processTournaments(data) {
  data.forEach(tournament => {
    const id = tournament['_id'];
    const fetchTourneyURL = `https://dtmwra1jsgyb0.cloudfront.net/tournaments/${id}`
    httpGet(fetchTourneyURL, {}, result=> {
      const stageId = result['stageIDs'][0];
      const top8Id = result['stageIDs'][1];
      const slug = result['slug'];
      const parts = slug.split('-');
      const tournamentLoc = parts[parts.length-2];
      const tournamentNum = parseInt(parts[parts.length-1], 10);
      const fetchBracketUrl = `https://dtmwra1jsgyb0.cloudfront.net/stages/${stageId}`;
      const startTime = new Date(result['startTime']);
      if (stageId) {
        httpGet(fetchBracketUrl, {}, res => {
          if (res['bracket']['type']) {
            if (res['bracket']['type']==='swiss'||res['bracket']['type']==='custom') {
              handleSwiss(id, slug, tournamentLoc, tournamentNum, stageId, top8Id, startTime);
            } else {
              handleSingleElim(id, slug, tournamentLoc, tournamentNum, stageId, startTime);
            }
          }
        });
      }
    });
  });
}

function processTop8(id, slug, standings, tournamentLoc, tournamentNum, startTime) {
  const qualified = standings.filter(e=>e['place']<=1).map(a=>a['team']['name']);
  if (qualified.length != 0) {
    writeWinner(id, qualified, startTime);
  }
  const top8 = standings.map(x=>x['team']['name']).filter(x=>x);
  writeTop8(id, slug, top8, tournamentLoc, tournamentNum);
}

function writeTop8(id, slug, players, tournamentLoc, tournamentNum) {
  if (players.length===0) {
    return;
  }
  mongodb.MongoClient.connect(uri, {useUnifiedTopology: true, useNewUrlParser: true}, (err, client) => {
    if (err) throw err;

    const db = client.db();
    const top8 = db.collection('top8');
    let count = 0;
    players.map(name => {
      top8.updateOne({_id: name},{$addToSet: {tournaments: {id: id, slug: slug, tournamentId: tournamentLoc, tournamentNum: tournamentNum}}}, {upsert:true}, (err, res) => {
        if (err) throw err;
        count += 1;
        if (count >= players.length) {
          client.close();
        }
      });
    });
  });
}

function writeWinner(id, name, startTime) {
  mongodb.MongoClient.connect(uri, {useUnifiedTopology: true, useNewUrlParser: true}, (err, client) => {
    if (err) throw err;

    const db = client.db();
    const winners = db.collection('winners');
    winners.updateOne({_id: id},{$set: {name: name, startTime: startTime}}, {upsert:true}, (err, res) => {
      if (err) throw err;
      client.close();
    });
  });
}

function updateGrandmaster() {
  const url = 'https://playhearthstone.com/en-us/api/esports/schedule/grandmasters/?season=null&year=null';
  httpGet(url, {}, handleGrandmaster);
}

function handleGrandmaster(gmData) {
  const tournaments = gmData.requestedSeasonTournaments;
  const data = [];
  tournaments.forEach(tournament => {
    const region = tournament.region;
    tournament.stages.forEach(stage => {
      stage.brackets.forEach(bracket => {
        bracket.matches.forEach(match => {
          const player1 = match.competitors[0] ? match.competitors[0].name : '';
          const player2 = match.competitors[1] ? match.competitors[1].name : '';
          let player1Decks;
          if (match.attributes.competitor_1) {
            player1Decks = match.attributes.competitor_1.decklist.map(a=>a['deckCode']);
            player2Decks = match.attributes.competitor_2.decklist.map(a=>a['deckCode']);
            player1Classes = match.attributes.competitor_1.decklist.map(
              a=>{return {class: a['class'],banned:a['attributes']==='Banned'}});
            player2Classes = match.attributes.competitor_2.decklist.map(
              a=>{return {class: a['class'],banned:a['attributes']==='Banned'}});
          } else if (match.attributes.competitor_1_decklists) {
            player1Decks = match.attributes.competitor_1_decklists;
            player2Decks = match.attributes.competitor_2_decklists;
            player1Classes = [{class: match.attributes.competitor_1_class, banned: false}];
            player2Classes = [{class: match.attributes.competitor_2_class, banned: false}];
          } else {
            player1Decks = [];
            player2Decks = [];
            player1Classes = [];
            player2Classes = [];
          }
          const score = match.scores.map(a=>a.value);
          const id = match.id;
          const startDate = match.startDate;
          const matchData = {
            id: id,
            competitor_1: player1,
            competitor_2: player2,
            competitor_1_decks: player1Decks,
            competitor_1_classes: player1Classes,
            competitor_2_decks: player2Decks,
            competitor_2_classes: player2Classes,
            score: score,
            region: region,
            startDate: startDate
          };
          if ((player1 || player2) && startDate) {
            data.push(matchData);
          }
        });
      });
    });
  });
  data.sort((a,b) => a.startDate - b.startDate);
  writeGmData(data);
}

function writeGmData(gmData) {
  mongodb.MongoClient.connect(uri, {useUnifiedTopology: true, useNewUrlParser: true}, (err, client) => {
    if (err) throw err;

    const db = client.db();
    const gm = db.collection('grandmaster');
    gm.updateOne({_id: 'gm'},{$set: {data: gmData}}, {upsert: true}, (err, res) => {
        if (err) throw err;
        client.close();
      });
  });
}

function update(type, args) {
  if (type === 'manual') {
    const id = args['id'];
    const slug = args['slug'];
    const tournamentLoc = args['tournamentLoc'];
    const tournamentNum = args['tournamentNum'];
    manualTop8(id, slug, tournamentLoc, tournamentNum);
  } else if (type === 'grandmaster') {
    updateGrandmaster()
  } else if (type === 'sync') {
    const start = args['start'];
    const end = args['end'];
    updateGrandmaster();
    updateTournaments(true, start, end);
  } else {
    updateGrandmaster();
    updateTournaments();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const type = args[0];
  if (type === 'manual') {
    update(type, {
      'id': args[1],
      'slug': args[2],
      'tournamentLoc': args[3],
      'tournamentNum': args[4]
    });
  } else if (type === 'sync') {
    update(type, {
      'start': args[1],
      'end': args[2]
    });
  } else {
    update(type);
  }
}

module.exports = update;