import React, {Component} from 'react';
import { Link } from 'react-router-dom';
import DocumentTitle from 'react-document-title'

import { validateDecks, compareDecks, findDeckCode } from '../deckutils.js';
import DeckOptions from './deckoptions';
import DeckDiff from './deckdiff';
import Deck from './deck';

const queryString = require('query-string');

class BattlefyDecks extends Component {

  state = {
    player : '',
    decks : [],
    isValid : false,
    isLoaded : false,
    error : null,
    isDiff : true
  }

  constructor() {
    super();
    this.handleToggleDiff = this.handleToggleDiff.bind(this);
  }

  handleToggleDiff(isDiff) {
    this.setState({isDiff: isDiff});
  }

  componentDidMount() {
    const pathname = this.props.location.pathname;
    const id = pathname.split('/')[3];
    const values = queryString.parse(this.props.location.search);
    const player = values['player'];
    const fetchURL = `https://dtmwra1jsgyb0.cloudfront.net/matches/${id}?extend%5Btop.team%5D%5Bplayers%5D%5Buser%5D=true&extend%5Bbottom.team%5D%5Bplayers%5D%5Buser%5D=true`;
    fetch(fetchURL)
      .then(res => res.json())
      .then(
        (result) => {
          ['top', 'bottom'].forEach(i=> {
            if (!result[0][i]['team']) {
              return;
            }
            const playerName = result[0][i]['team']['name'];
            if (!player || player===playerName) {
              const decks = result[0][i]['team']['players'][0]['gameAttributes']['deckStrings'];
              this.setState({
                player: playerName
              })
              this.processDecks(decks);
              return;
            }
          });
          this.setState({isLoaded: true});
        },
        // Note: it's important to handle errors here
        // instead of a catch() block so that we don't swallow
        // exceptions from actual bugs in components.
        (error) => {
          this.setState({
            isLoaded: true,
            error
          });
        }
      )
  }

  processDecks(codes) {
    codes = codes.map(code => findDeckCode(code, true));
    const result = validateDecks(codes);
    if (!result[0]) {
      this.setState({
        isValid: false
      });
    } else {
      this.setState({
        decks: result[1],
        isValid: true
      });
    }
  }

  render() {
    if (this.state.isLoaded && !this.state.error && this.state.isValid) {
      const isSpecialist = this.state.decks.every(deck=>deck.class===this.state.decks[0].class);
      let decks;
      if (this.state.isDiff) {
        decks = [];
        decks.push((
          <div key={'Deck'+(1)} className='col-sm'>
            <Deck index={1} deck={this.state.decks[0]}></Deck>
          </div>
        ))
        decks = decks.concat(this.state.decks.slice(1).map((deck, i)=> {
          const diffs = compareDecks(this.state.decks[0],deck);
          return (
            <div key={'Diff'+(i+1)} className='col-sm'>
              <DeckDiff index={i+2} removed={diffs[0]} added={diffs[1]} deck={this.state.decks[i+1]}></DeckDiff>
            </div>
          );
        }));
      } else {
        decks = this.state.decks.map((deck, i)=> {
          return (
            <div key={'Deck'+(i+1)} className='col-sm'>
              <Deck index={i+1} deck={deck}></Deck>
            </div>
          );
        });
      }
      return (
        <DocumentTitle title={this.state.player}>
          <div className='container mt-2'>
            <Link className="btn btn-primary" role="button" to={`/battlefy/${this.props.location.pathname.split('/')[2]}`}>&lt; Back</Link>
            <h1>{this.state.player}'s Decks</h1>
            {isSpecialist && this.state.isValid ? <DeckOptions onToggleDiff={this.handleToggleDiff}></DeckOptions> : null}
            <div className='row'>
              {decks}
            </div>
          </div>
        </DocumentTitle>
      );
    } else if (!this.state.error && this.state.isLoaded && !this.state.isValid) {
      return <DocumentTitle title={this.state.player}><h2 style={{'color':'red'}}>Unknown error in validating decks</h2></DocumentTitle>;
    }
    else if (this.state.error) {
      return <h2 style={{'color':'red'}}>Error in fetching data</h2>;
    }
    return <DocumentTitle title='Loading Decks...'></DocumentTitle>;
  }
}

export default BattlefyDecks;